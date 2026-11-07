import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { configPaths, loadRuntimeSettings } from '../feature/swarm-config/services/index.ts';
import { findExecutable } from '../platform/process/index.ts';
import type { Style } from '../protocol/index.ts';
import { setupFailure } from './io.ts';

export interface SetupOptions {
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  claude: boolean;
  opencode: boolean;
  plugin: boolean;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything that touches the machine; tests pass fakes. */
export interface SetupDeps {
  env: NodeJS.ProcessEnv;
  /** Root of this installation: the directory with package.json. */
  root: string;
  exec(bin: string, args: string[]): Promise<ExecResult>;
  find(name: string): string | null;
  realpath(path: string): string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
}

export function systemDeps(env: NodeJS.ProcessEnv): SetupDeps {
  return {
    env,
    root: join(import.meta.dirname, '..', '..'),
    exec: (bin, args) =>
      new Promise((resolve) => {
        execFile(bin, args, { timeout: 120_000, env }, (error, stdout, stderr) =>
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: String(stdout),
            stderr:
              String(stderr) || (error && typeof error.code !== 'number' ? error.message : ''),
          }),
        );
      }),
    find: (name) => findExecutable(name, env.PATH),
    realpath: (path) => realpathSync(path),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    exists: (path) => existsSync(path),
  };
}

export type CheckResult =
  | { state: 'configured' }
  | { state: 'missing' }
  | { state: 'skip'; reason: string }
  | { state: 'differs'; detail: string }
  | { state: 'error'; reason: string };

export interface SetupAction {
  id: 'prerequisites' | 'claude-mcp' | 'claude-plugin' | 'opencode-mcp';
  label: string;
  /** What the action does, in the imperative; printed for a dry run. */
  plan: string;
  check(): Promise<CheckResult>;
  /** `replace` is true when a different setting has to be overwritten (`--force`). */
  apply(replace: boolean): Promise<void>;
}

export type OutcomeStatus = 'done' | 'configured' | 'skipped' | 'differs' | 'failed' | 'planned';

export interface Outcome {
  id: SetupAction['id'];
  label: string;
  status: OutcomeStatus;
  message: string;
}

/** Whether `root` is a temporary `npx` copy of the package. */
export function isNpxCache(root: string, env: NodeJS.ProcessEnv): boolean {
  if (/[\\/]_npx[\\/]/.test(root)) return true;
  const cache = env.npm_config_cache;
  return Boolean(cache) && root.startsWith(`${cache}/`);
}

/**
 * The command that starts aip for a host: `aip` when the `aip` in PATH is this installation,
 * otherwise Node.js with the absolute path of this installation's CLI.
 */
export function resolveAipCommand(deps: SetupDeps): string[] {
  const built = join(deps.root, 'dist', 'cli', 'main.js');
  const entry = deps.exists(built) ? built : (process.argv[1] ?? built);
  const found = deps.find('aip');
  if (found) {
    try {
      if (deps.realpath(found) === deps.realpath(entry)) return ['aip'];
    } catch {
      // A dangling link: fall through to the absolute path.
    }
  }
  return [process.execPath, entry];
}

function failure(result: ExecResult): string {
  return (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`)
    .split('\n')
    .slice(0, 3)
    .join(' ');
}

function hostBinary(
  deps: SetupDeps,
  variable: 'AIP_CLAUDE_BIN' | 'AIP_OPENCODE_BIN',
  name: 'claude' | 'opencode',
): string | null {
  if (deps.env[variable]) return deps.find(deps.env[variable]);
  let command = name as string;
  try {
    command = loadRuntimeSettings(configPaths(deps.root, deps.env.XDG_CONFIG_HOME, deps.env.HOME))[
      name
    ].command;
  } catch {
    // The default command of a runtime is its name.
  }
  return deps.find(command);
}

function prerequisites(deps: SetupDeps): SetupAction {
  return {
    id: 'prerequisites',
    label: 'Node.js and git',
    plan: 'check Node.js 24 or newer and git',
    check: async () => {
      const major = Number(process.versions.node.split('.')[0]);
      if (major < 24) {
        return {
          state: 'error',
          reason: `Node.js ${process.versions.node} found, 24 or newer is required`,
        };
      }
      if (!deps.find('git')) return { state: 'error', reason: 'git not found in PATH' };
      return { state: 'configured' };
    },
    apply: async () => undefined,
  };
}

/** `Command: x` and `Args: y z` of `claude mcp get`, joined. */
function registeredCommand(output: string): string {
  const command = /^\s*Command:\s*(.*)$/m.exec(output)?.[1]?.trim() ?? '';
  const args = /^\s*Args:\s*(.*)$/m.exec(output)?.[1]?.trim() ?? '';
  return [command, args].filter(Boolean).join(' ');
}

function claudeMcp(deps: SetupDeps, command: string[]): SetupAction {
  const wanted = [...command, 'mcp'];
  const manual = `claude mcp add --scope user aip -- ${wanted.join(' ')}`;
  return {
    id: 'claude-mcp',
    label: 'Claude Code: MCP server',
    plan: `run \`${manual}\``,
    check: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude');
      if (!bin) return { state: 'skip', reason: 'claude not found in PATH' };
      const result = await deps.exec(bin, ['mcp', 'get', 'aip']);
      if (result.code !== 0) return { state: 'missing' };
      const current = registeredCommand(result.stdout);
      return current === wanted.join(' ')
        ? { state: 'configured' }
        : {
            state: 'differs',
            detail: `already registered as \`${current}\`; use --force to replace it`,
          };
    },
    apply: async (replace) => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude')!;
      if (replace) await deps.exec(bin, ['mcp', 'remove', '--scope', 'user', 'aip']);
      const result = await deps.exec(bin, [
        'mcp',
        'add',
        '--scope',
        'user',
        'aip',
        '--',
        ...wanted,
      ]);
      if (result.code !== 0) throw setupFailure(`${failure(result)} (manual: ${manual})`);
    },
  };
}

function claudePlugin(deps: SetupDeps): SetupAction {
  const marketplace = deps.root;
  const manual = `claude plugin marketplace add ${marketplace} && claude plugin install aip@aip`;
  const fallback = 'or start Claude Code with --plugin-dir <aip>/integrations/claude-code';
  let outdated = false;
  /** The version in this installation's plugin manifest, or null when it cannot be read. */
  const wantedVersion = (): string | null => {
    const text = deps.readFile(
      join(marketplace, 'integrations', 'claude-code', '.claude-plugin', 'plugin.json'),
    );
    try {
      const version: unknown = text === null ? null : JSON.parse(text).version;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  };
  return {
    id: 'claude-plugin',
    label: 'Claude Code: aip plugin',
    plan: `run \`${manual}\``,
    check: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude');
      if (!bin) return { state: 'skip', reason: 'claude not found in PATH' };
      if (!deps.exists(join(marketplace, '.claude-plugin', 'marketplace.json'))) {
        return { state: 'skip', reason: `no plugin manifest in ${marketplace}; ${fallback}` };
      }
      const result = await deps.exec(bin, ['plugin', 'list']);
      if (result.code !== 0) {
        return {
          state: 'skip',
          reason: `this Claude Code has no \`claude plugin\`; install by hand: ${manual}; ${fallback}`,
        };
      }
      outdated = false;
      const listed = /\baip@aip\b/.exec(result.stdout);
      if (!listed) return { state: 'missing' };
      // Claude Code keeps its own copy of the plugin: after a package update it can be old.
      const rest = result.stdout.slice(listed.index + listed[0].length);
      const entry = rest.split(/\r?\n(?=\S*\s*[\w.-]+@[\w.-]+\s*$)/m)[0] ?? '';
      const installed = /Version:\s*v?(\S+)/i.exec(entry)?.[1];
      const wanted = wantedVersion();
      if (installed && wanted && installed !== wanted) {
        outdated = true;
        return { state: 'missing' };
      }
      return { state: 'configured' };
    },
    apply: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude')!;
      if (outdated) {
        const manualUpdate = 'claude plugin marketplace update aip && claude plugin update aip@aip';
        const refreshed = await deps.exec(bin, ['plugin', 'marketplace', 'update', 'aip']);
        if (refreshed.code !== 0)
          throw setupFailure(`${failure(refreshed)} (manual: ${manualUpdate})`);
        const updated = await deps.exec(bin, ['plugin', 'update', 'aip@aip']);
        if (updated.code !== 0) throw setupFailure(`${failure(updated)} (manual: ${manualUpdate})`);
        return;
      }
      const added = await deps.exec(bin, ['plugin', 'marketplace', 'add', marketplace]);
      if (added.code !== 0 && !/already/i.test(added.stderr + added.stdout)) {
        throw setupFailure(`${failure(added)} (manual: ${manual})`);
      }
      const installed = await deps.exec(bin, ['plugin', 'install', 'aip@aip']);
      if (installed.code !== 0) throw setupFailure(`${failure(installed)} (manual: ${manual})`);
    },
  };
}

export function opencodeConfigPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'opencode', 'opencode.json');
}

function opencodeMcp(deps: SetupDeps, command: string[]): SetupAction {
  const wanted = [...command, 'mcp'];
  const path = opencodeConfigPath(deps.env);
  const entry = { type: 'local', command: wanted, enabled: true };
  const snippet = JSON.stringify({ mcp: { aip: entry } }, null, 2);
  const unparsable = (why: string): CheckResult => ({
    state: 'skip',
    reason: `${why}; add this to it by hand:\n${snippet}`,
  });
  function read(): { config: Record<string, any> } | CheckResult {
    const text = deps.readFile(path);
    if (text === null) {
      return deps.exists(`${path}c`)
        ? unparsable(`${path}c has comments and is left alone`)
        : { config: {} };
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return unparsable(`${path} is not a JSON object`);
      }
      return { config: parsed as Record<string, any> };
    } catch {
      return unparsable(`${path} is not valid JSON`);
    }
  }
  return {
    id: 'opencode-mcp',
    label: 'OpenCode: MCP server',
    plan: `add \`mcp.aip\` to ${path}`,
    check: async () => {
      if (!hostBinary(deps, 'AIP_OPENCODE_BIN', 'opencode')) {
        return { state: 'skip', reason: 'opencode not found in PATH' };
      }
      const loaded = read();
      if (!('config' in loaded)) return loaded;
      const current = loaded.config.mcp?.aip;
      if (current === undefined) return { state: 'missing' };
      return JSON.stringify(current.command) === JSON.stringify(wanted)
        ? { state: 'configured' }
        : {
            state: 'differs',
            detail: `${path} already has mcp.aip with another command; use --force to replace it`,
          };
    },
    apply: async () => {
      const loaded = read();
      if (!('config' in loaded)) throw setupFailure('the configuration changed while setup ran');
      const config = loaded.config;
      config.mcp = { ...(config.mcp ?? {}), aip: entry };
      if (config.$schema === undefined) config.$schema = 'https://opencode.ai/config.json';
      deps.writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    },
  };
}

export function planSetup(options: SetupOptions, deps: SetupDeps): SetupAction[] {
  const command = resolveAipCommand(deps);
  const actions: SetupAction[] = [prerequisites(deps)];
  if (options.claude) {
    actions.push(claudeMcp(deps, command));
    if (options.plugin) actions.push(claudePlugin(deps));
  }
  if (options.opencode) actions.push(opencodeMcp(deps, command));
  return actions;
}

/** Runs the actions one by one; a failure of one does not stop the others. */
export async function runSetup(
  actions: SetupAction[],
  options: Pick<SetupOptions, 'dryRun' | 'force'>,
  report: (outcome: Outcome) => void = () => undefined,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const action of actions) {
    const base = { id: action.id, label: action.label };
    let outcome: Outcome;
    try {
      const checked = await action.check();
      if (checked.state === 'configured') {
        outcome = { ...base, status: 'configured', message: 'already set up' };
      } else if (checked.state === 'skip') {
        outcome = { ...base, status: 'skipped', message: checked.reason };
      } else if (checked.state === 'error') {
        outcome = { ...base, status: 'failed', message: checked.reason };
      } else if (checked.state === 'differs' && !options.force) {
        outcome = { ...base, status: 'differs', message: checked.detail };
      } else if (options.dryRun) {
        outcome = { ...base, status: 'planned', message: `would ${action.plan}` };
      } else {
        await action.apply(checked.state === 'differs');
        outcome = { ...base, status: 'done', message: 'set up' };
      }
    } catch (error) {
      outcome = { ...base, status: 'failed', message: (error as Error).message };
    }
    outcomes.push(outcome);
    report(outcome);
  }
  return outcomes;
}

const BADGES: Record<OutcomeStatus, { badge: string; role: keyof Style }> = {
  done: { badge: '✓', role: 'success' },
  configured: { badge: '✓', role: 'success' },
  planned: { badge: '·', role: 'command' },
  skipped: { badge: '-', role: 'muted' },
  differs: { badge: '!', role: 'warning' },
  failed: { badge: '✗', role: 'danger' },
};

export function formatOutcome(outcome: Outcome, style: Style): string {
  const { badge, role } = BADGES[outcome.status];
  return `${style[role](badge)} ${outcome.label}: ${outcome.message}`;
}

function packageName(root: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
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
