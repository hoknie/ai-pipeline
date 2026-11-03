import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerCommands } from '../../src/cli/commands.ts';
import { HELP_GROUPS } from '../../src/cli/help.ts';

const root = join(import.meta.dirname, '..', '..');
const main = join(root, 'src', 'cli', 'main.ts');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-help-')));

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const clean = { ...process.env, ...extra };
  for (const key of ['NO_COLOR', 'FORCE_COLOR']) if (!(key in extra)) delete clean[key];
  return {
    ...clean,
    XDG_STATE_HOME: join(base, 'state'),
    XDG_CONFIG_HOME: join(base, 'config'),
  };
}

function aip(
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [main, ...args],
      { cwd: base, env: env(extra), timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

function tree(): Command {
  const program = new Command().name('aip');
  registerCommands(program);
  return program;
}

function leaves(command: Command, path: string[] = []): string[][] {
  return command.commands.flatMap((sub) => {
    const next = [...path, sub.name()];
    return sub.commands.length > 0 ? leaves(sub, next) : [next];
  });
}

const ANSI = '\x1b[';

describe('grouped help', () => {
  it('prints five groups in order and no Commands section', async () => {
    const { stdout, code } = await aip(['--help']);
    expect(code).toBe(0);
    const positions = [
      'Runs:',
      'Queue & repositories:',
      'Dashboards & streams:',
      'Setup & maintenance:',
      'Plumbing',
    ].map((heading) => stdout.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(stdout).not.toContain('Commands:');
  });

  it('puts every top-level command into exactly one group, help under Setup & maintenance', () => {
    const names = tree().commands.map((command) => command.name());
    const grouped = HELP_GROUPS.flatMap((group) => group.commands);
    expect([...grouped].sort()).toEqual([...names, 'help'].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    const setup = HELP_GROUPS.find((group) => group.heading.startsWith('Setup'));
    expect(setup?.commands).toContain('help');
  });

  it('lists help below Setup & maintenance', async () => {
    const { stdout } = await aip(['--help']);
    const setup = stdout.slice(stdout.indexOf('Setup & maintenance:'), stdout.indexOf('Plumbing'));
    expect(setup).toMatch(/\n\s+help /);
  });

  it('ends with a footer pointing to command help and docs', async () => {
    const { stdout } = await aip(['--help']);
    expect(stdout).toContain('aip <command> --help');
    expect(stdout).toContain('docs/');
    expect(stdout).toContain('docs/queue.md');
    expect(stdout).toContain('docs/web.md');
  });

  it('keeps lines within 80 characters', async () => {
    for (const args of [['--help'], ['run', '--help']]) {
      const { stdout } = await aip(args);
      for (const line of stdout.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it('gives every leaf command an Examples block with its full path', async () => {
    const paths = leaves(tree());
    const helps: string[] = [];
    // A few processes at a time: one by one, the start-up of each `aip` adds up to most of a minute.
    for (let index = 0; index < paths.length; index += 8)
      helps.push(
        ...(await Promise.all(
          paths
            .slice(index, index + 8)
            .map(async (path) => (await aip([...path, '--help'])).stdout),
        )),
      );
    for (const [index, path] of paths.entries()) {
      const stdout = helps[index]!;
      expect(stdout, path.join(' ')).toContain('Examples:');
      const lines = stdout
        .slice(stdout.indexOf('Examples:'))
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() !== '');
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines)
        expect(line.trim()).toMatch(new RegExp(`^\\$ aip ${path.join(' ')}\\b`));
    }
  }, 120_000);

  it('prints help to stdout with code 0 for aip and a bare noun', async () => {
    for (const args of [[], ['run'], ['group'], ['--no-color', 'run'], ['queue']]) {
      const result = await aip(args);
      expect(result.code, args.join(' ')).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Usage: aip');
    }
  });

  it('does not treat `run --json` as a bare noun', async () => {
    const result = await aip(['run', '--json']);
    expect(result.stdout).not.toContain('Usage: aip run [options] [command]');
  });

  it('rejects the old command names without creating a run', async () => {
    const before = existsSync(join(base, 'state'));
    for (const args of [
      ['status'],
      ['apply', 'x'],
      ['retry', 'x', 'y'],
      ['run', 'feature', '--task', 'x'],
    ]) {
      const result = await aip(args);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stderr).toContain('unknown command');
    }
    expect(existsSync(join(base, 'state'))).toBe(before);
  });

  it('lists the subcommands of aip daemon with examples', async () => {
    const { stdout, code } = await aip(['daemon', '--help']);
    expect(code).toBe(0);
    for (const name of ['start', 'stop', 'restart', 'status']) expect(stdout).toContain(name);
    expect(stdout).toContain('aip daemon status');
  });

  it('lists the subcommands of aip web', async () => {
    const { stdout, code } = await aip(['web', '--help']);
    expect(code).toBe(0);
    for (const name of ['start', 'stop', 'restart', 'status']) expect(stdout).toContain(name);
  });

  it('rejects a mistyped daemon subcommand without starting the daemon', async () => {
    const { code, stderr } = await aip(['daemon', 'stpo']);
    expect(code).toBe(1);
    expect(stderr).not.toBe('');
    expect(existsSync(join(base, 'state', 'aip', 'aip.pid'))).toBe(false);
  });

  it('suggests a close command name', async () => {
    const verb = await aip(['run', 'lsit']);
    expect(verb.code).toBe(1);
    expect(verb.stderr).toContain('Did you mean list?');
    const noun = await aip(['qeue', 'list']);
    expect(noun.code).toBe(1);
    expect(noun.stderr).toContain('Did you mean queue?');
  });
});

describe('help colors', () => {
  it('has no ANSI without a terminal', async () => {
    expect((await aip(['--help'])).stdout).not.toContain(ANSI);
  });

  it('colors headings with FORCE_COLOR=1', async () => {
    const { stdout } = await aip(['--help'], { FORCE_COLOR: '1' });
    expect(stdout).toMatch(/\x1b\[[0-9;]*mRuns:/);
  });

  it('honors --no-color and NO_COLOR over FORCE_COLOR', async () => {
    expect((await aip(['--help', '--no-color'], { FORCE_COLOR: '1' })).stdout).not.toContain(ANSI);
    expect((await aip(['--help'], { FORCE_COLOR: '1', NO_COLOR: '1' })).stdout).not.toContain(ANSI);
  });
});
