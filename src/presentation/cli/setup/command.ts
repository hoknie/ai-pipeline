import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Style } from '../../format/index.ts';

import { failure } from './host.ts';
import { formatOutcome, planSetup, runSetup } from './run.ts';
import { isNpxCache } from './system.ts';
import type { SetupDeps, SetupOptions } from './types.ts';

function packageName(root: string): { name: string; version: string } {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return { name: manifest.name, version: manifest.version };
}

type Ask = (question: string) => Promise<string | null>;

async function confirm(ask: Ask, question: string): Promise<boolean> {
  const answer = await ask(question);
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}

/** Flags to hand to `aip setup` when it restarts itself from the global installation. */
function flagsOf(options: SetupOptions): string[] {
  return [
    ...(options.yes ? ['--yes'] : []),
    ...(options.force ? ['--force'] : []),
    ...(options.claude ? [] : ['--no-claude']),
    ...(options.opencode ? [] : ['--no-opencode']),
    ...(options.plugin ? [] : ['--no-plugin']),
  ];
}

/**
 * Started from the temporary `npx` copy: installs the same version globally and runs `aip setup`
 * from there. Returns the exit code.
 */
async function installGloballyAndRestart(
  options: SetupOptions,
  deps: SetupDeps,
  style: Style,
  write: (line: string) => void,
  ask: Ask,
): Promise<number> {
  const { name, version } = packageName(deps.root);
  const spec = `${name}@${version}`;
  const command = `npm install -g ${spec}`;
  if (options.dryRun) {
    write(
      `${style.command('·')} would run \`${command}\` and then \`aip setup\` from the installed copy`,
    );
    return 0;
  }
  if (
    !options.yes &&
    !(await confirm(
      ask,
      `aip is running from a temporary npx copy. Install ${spec} globally? [y/N] `,
    ))
  ) {
    write(`${style.danger('✗')} Not installed. Run \`${command}\` yourself, then \`aip setup\`.`);
    return 1;
  }
  const installed = await deps.exec('npm', ['install', '-g', spec]);
  if (installed.code !== 0) {
    write(`${style.danger('✗')} \`${command}\` failed: ${failure(installed)}`);
    write(
      '  If it is a permissions error, give npm a prefix in your home directory: `npm config set prefix ~/.local`, and add ~/.local/bin to PATH.',
    );
    return 1;
  }
  write(`${style.success('✓')} Installed ${spec} globally`);
  // npm puts the command into the global prefix; an older aip earlier in PATH must not win.
  const prefix = (await deps.exec('npm', ['prefix', '-g'])).stdout.trim();
  let bin: string | null = prefix ? join(prefix, 'bin', 'aip') : null;
  if (!bin || !deps.exists(bin)) bin = deps.find('aip');
  if (!bin || !deps.exists(bin)) {
    write(
      `${style.danger('✗')} The installed aip was not found. Open a new shell and run \`aip setup\`.`,
    );
    return 1;
  }
  return new Promise((resolve) => {
    const child = spawn(bin, ['setup', ...flagsOf(options)], { stdio: 'inherit', env: deps.env });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** `aip setup`: returns the exit code. */
export async function setupCommand(
  options: SetupOptions,
  style: Style,
  deps: SetupDeps,
  write: (line: string) => void,
  ask: Ask = async () => null,
): Promise<number> {
  if (isNpxCache(deps.root, deps.env))
    return installGloballyAndRestart(options, deps, style, write, ask);
  const outcomes = await runSetup(planSetup(options, deps), options, (outcome) =>
    write(formatOutcome(outcome, style)),
  );
  if (!deps.find('aip')) {
    write(
      `${style.warning('!')} \`aip\` is not in PATH. Add the npm global bin directory to PATH, or set the plugin option aipCommand to ["${process.execPath}", "${join(deps.root, 'dist', 'cli', 'main.js')}"].`,
    );
  }
  const failed = outcomes.some((outcome) => outcome.status === 'failed');
  if (!failed) {
    write(
      options.dryRun
        ? `\n${style.muted('Dry run: nothing was changed.')}`
        : `\nNext: open a repository and run ${style.command('aip init')}. Restart Claude Code and OpenCode to pick up the new server.`,
    );
  }
  return failed ? 1 : 0;
}
