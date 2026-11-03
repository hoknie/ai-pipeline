import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const main = join(root, 'src', 'cli', 'main.ts');
const fakes = join(root, 'test', 'fakes');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-setup-')));

interface Machine {
  dir: string;
  env: NodeJS.ProcessEnv;
  hostState: string;
  opencodeConfig: string;
}

let counter = 0;

function machine(extra: NodeJS.ProcessEnv = {}): Machine {
  const dir = join(base, `m${(counter += 1)}`);
  mkdirSync(join(dir, 'home'), { recursive: true });
  const hostState = join(dir, 'host.json');
  return {
    dir,
    hostState,
    opencodeConfig: join(dir, 'config', 'opencode', 'opencode.json'),
    env: {
      ...process.env,
      HOME: join(dir, 'home'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      XDG_STATE_HOME: join(dir, 'state'),
      PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
      AIP_CLAUDE_BIN: join(fakes, 'claude'),
      AIP_OPENCODE_BIN: join(fakes, 'opencode'),
      AIP_FAKE_HOST_STATE: hostState,
      NO_COLOR: '1',
      ...extra,
    },
  };
}

function setup(m: Machine, args: string[] = [], input?: string) {
  const result = spawnSync(process.execPath, [main, 'setup', ...args], {
    env: m.env,
    cwd: m.dir,
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function state(m: Machine): {
  mcp: Record<string, { args: string[] }>;
  plugins: string[];
  marketplaces: string[];
} {
  return JSON.parse(readFileSync(m.hostState, 'utf8'));
}

describe('aip setup', () => {
  it('sets up Claude Code and OpenCode, and a second run changes nothing', () => {
    const m = machine();
    const first = setup(m, ['--yes']);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(Object.keys(state(m).mcp)).toEqual(['aip']);
    expect(state(m).mcp.aip!.args.at(-1)).toBe('mcp');
    expect(state(m).plugins).toEqual(['aip@aip']);
    expect(state(m).marketplaces).toEqual([root]);
    const opencode = JSON.parse(readFileSync(m.opencodeConfig, 'utf8'));
    expect(opencode.mcp.aip.command.at(-1)).toBe('mcp');
    expect(first.stdout).toContain('aip init');

    const stateBefore = readFileSync(m.hostState, 'utf8');
    const configBefore = readFileSync(m.opencodeConfig, 'utf8');
    const second = setup(m, ['--yes']);
    expect(second.code).toBe(0);
    expect(second.stdout.match(/already set up/g)).toHaveLength(4);
    expect(readFileSync(m.hostState, 'utf8')).toBe(stateBefore);
    expect(readFileSync(m.opencodeConfig, 'utf8')).toBe(configBefore);
  });

  it('finds Claude Code by the command of runtimes and does not pass its arguments', () => {
    const m = machine({ AIP_CLAUDE_BIN: '' });
    const directory = join(m.dir, 'config', 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'settings.yaml'),
      `runtimes:\n  claude:\n    command: ${join(fakes, 'claude')}\n    args: [--debug]\n`,
    );
    const result = setup(m, ['--yes']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(Object.keys(state(m).mcp)).toEqual(['aip']);
    expect(state(m).mcp.aip!.args).not.toContain('--debug');
  });

  it('skips OpenCode when it is not installed and exits with 0', () => {
    const m = machine({ AIP_OPENCODE_BIN: join(tmpdir(), 'no-such-opencode') });
    const result = setup(m);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('opencode not found');
    expect(existsSync(m.opencodeConfig)).toBe(false);
    expect(Object.keys(state(m).mcp)).toEqual(['aip']);
  });

  it('reports a failed registration, does the rest and exits with 1', () => {
    const m = machine({ AIP_FAKE_HOST_FAIL: 'mcp add' });
    const result = setup(m);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Claude Code: MCP server');
    expect(result.stdout).toContain('mcp add');
    expect(existsSync(m.opencodeConfig)).toBe(true);
  });

  it('changes nothing on a dry run', () => {
    const m = machine();
    const result = setup(m, ['--dry-run']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would');
    expect(existsSync(m.hostState)).toBe(false);
    expect(existsSync(m.opencodeConfig)).toBe(false);
  });

  it('skips the plugin with a manual command when claude plugin is unknown', () => {
    const m = machine({ AIP_FAKE_HOST_FAIL: 'plugin' });
    const result = setup(m);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('claude plugin install aip@aip');
    expect(Object.keys(state(m).mcp)).toEqual(['aip']);
  });

  it('honors --no-claude and --no-opencode', () => {
    const m = machine();
    const result = setup(m, ['--no-claude', '--no-opencode']);
    expect(result.code).toBe(0);
    expect(existsSync(m.hostState)).toBe(false);
    expect(existsSync(m.opencodeConfig)).toBe(false);
  });
});

describe('aip setup from the npx cache', () => {
  /** A fake npm that logs its arguments and a fake aip it "installs". */
  function npxMachine(npmExit = 0) {
    const m = machine({ npm_config_cache: dirname(root) });
    const tools = join(m.dir, 'tools');
    const prefix = join(m.dir, 'prefix');
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    mkdirSync(tools, { recursive: true });
    const log = join(m.dir, 'calls.log');
    const npm = join(tools, 'npm');
    writeFileSync(
      npm,
      `#!/bin/sh
echo "npm $*" >> "${log}"
if [ "$1" = "prefix" ]; then echo "${prefix}"; exit 0; fi
if [ "$1" = "install" ]; then
  [ ${npmExit} -ne 0 ] && { echo "EACCES" >&2; exit ${npmExit}; }
  printf '#!/bin/sh\\necho "aip $*" >> "${log}"\\n' > "${prefix}/bin/aip"
  chmod +x "${prefix}/bin/aip"
fi
exit 0
`,
    );
    chmodSync(npm, 0o755);
    m.env.PATH = [tools, m.env.PATH].join(delimiter);
    return { m, log };
  }

  it('installs the same version globally and restarts setup from there', () => {
    const { m, log } = npxMachine();
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const result = setup(m, ['--yes', '--no-opencode']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain(`npm install -g @hoknie/aip@${version}`);
    expect(calls).toContain('aip setup --yes --no-opencode');
    expect(existsSync(m.hostState)).toBe(false);
  });

  it('registers nothing when the user declines', () => {
    const { m, log } = npxMachine();
    const result = setup(m, [], 'n\n');
    expect(result.code).toBe(1);
    expect(existsSync(log)).toBe(false);
    expect(existsSync(m.hostState)).toBe(false);
  });

  it('exits with 1 when npm fails', () => {
    const { m } = npxMachine(1);
    const result = setup(m, ['--yes']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('npm config set prefix');
    expect(existsSync(m.hostState)).toBe(false);
  });
});
