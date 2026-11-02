import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isNpxCache,
  opencodeConfigPath,
  planSetup,
  resolveAipCommand,
  runSetup,
  type ExecResult,
  type SetupDeps,
  type SetupOptions,
} from '../../src/cli/setup.ts';

const options: SetupOptions = {
  yes: true,
  dryRun: false,
  force: false,
  claude: true,
  opencode: true,
  plugin: true,
};

interface Fake {
  deps: SetupDeps;
  calls: string[][];
  files: Map<string, string>;
}

/** Deps over an in-memory machine; `claude` and `opencode` exist unless `missing` lists them. */
function fake(
  extra: {
    missing?: string[];
    aipInPath?: string;
    exec?: (args: string[]) => ExecResult;
    files?: Record<string, string>;
  } = {},
): Fake {
  const calls: string[][] = [];
  const files = new Map(Object.entries(extra.files ?? {}));
  const root = '/opt/aip';
  const deps: SetupDeps = {
    env: { HOME: '/home/u', XDG_CONFIG_HOME: '/home/u/.config' },
    root,
    exec: async (_bin, args) => {
      calls.push(args);
      return extra.exec?.(args) ?? { code: 1, stdout: '', stderr: 'not found' };
    },
    find: (name) => {
      if (extra.missing?.includes(name)) return null;
      if (name === 'aip') return extra.aipInPath ?? null;
      return `/bin/${name}`;
    },
    realpath: (path) => path,
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, content) => void files.set(path, content),
    exists: (path) =>
      files.has(path) ||
      path === join(root, 'dist/cli/main.js') ||
      path.endsWith('marketplace.json'),
  };
  return { deps, calls, files };
}

const ok: ExecResult = { code: 0, stdout: '', stderr: '' };

describe('resolveAipCommand', () => {
  it('uses aip when the aip in PATH is this installation', () => {
    const { deps } = fake({ aipInPath: '/opt/aip/dist/cli/main.js' });
    expect(resolveAipCommand(deps)).toEqual(['aip']);
  });

  it('uses absolute paths when aip is not in PATH', () => {
    const { deps } = fake();
    expect(resolveAipCommand(deps)).toEqual([process.execPath, '/opt/aip/dist/cli/main.js']);
  });

  it('uses absolute paths when the aip in PATH is another installation', () => {
    const { deps } = fake({ aipInPath: '/elsewhere/aip' });
    expect(resolveAipCommand(deps)[0]).toBe(process.execPath);
  });
});

describe('isNpxCache', () => {
  it('recognizes the npx directory and the npm cache', () => {
    expect(isNpxCache('/h/.npm/_npx/abc/node_modules/@hoknie/aip', {})).toBe(true);
    expect(isNpxCache('/cache/x/aip', { npm_config_cache: '/cache' })).toBe(true);
    expect(isNpxCache('/usr/lib/node_modules/@hoknie/aip', { npm_config_cache: '/cache' })).toBe(
      false,
    );
  });
});

describe('opencode action', () => {
  const path = opencodeConfigPath({ XDG_CONFIG_HOME: '/home/u/.config' });

  it('creates the file with mcp.aip', async () => {
    const { deps, files } = fake();
    const outcomes = await runSetup(planSetup({ ...options, claude: false }, deps), options);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['configured', 'done']);
    const config = JSON.parse(files.get(path)!);
    expect(config.mcp.aip).toEqual({
      type: 'local',
      command: [process.execPath, '/opt/aip/dist/cli/main.js', 'mcp'],
      enabled: true,
    });
  });

  it('keeps the other keys of the file', async () => {
    const { deps, files } = fake({
      files: { [path]: JSON.stringify({ theme: 'dark', mcp: { other: { type: 'remote' } } }) },
    });
    await runSetup(planSetup({ ...options, claude: false }, deps), options);
    const config = JSON.parse(files.get(path)!);
    expect(config.theme).toBe('dark');
    expect(config.mcp.other).toEqual({ type: 'remote' });
    expect(config.mcp.aip).toBeDefined();
  });

  it('is already set up on the second run and writes nothing', async () => {
    const { deps, files } = fake();
    const plan = planSetup({ ...options, claude: false }, deps);
    await runSetup(plan, options);
    const before = files.get(path);
    const again = await runSetup(plan, options);
    expect(again.at(-1)).toMatchObject({ status: 'configured' });
    expect(files.get(path)).toBe(before);
  });

  it('leaves a foreign command alone, and replaces it with --force', async () => {
    const foreign = JSON.stringify({
      keep: 1,
      mcp: { aip: { type: 'local', command: ['x', 'mcp'] } },
    });
    const first = fake({ files: { [path]: foreign } });
    const kept = await runSetup(planSetup({ ...options, claude: false }, first.deps), options);
    expect(kept.at(-1)?.status).toBe('differs');
    expect(first.files.get(path)).toBe(foreign);

    const second = fake({ files: { [path]: foreign } });
    const forced = await runSetup(planSetup({ ...options, claude: false }, second.deps), {
      dryRun: false,
      force: true,
    });
    expect(forced.at(-1)?.status).toBe('done');
    const config = JSON.parse(second.files.get(path)!);
    expect(config.keep).toBe(1);
    expect(config.mcp.aip.command).toContain('mcp');
    expect(config.mcp.aip.command[0]).not.toBe('x');
  });

  it('does not touch a file that is not JSON and prints the snippet', async () => {
    const { deps, files } = fake({ files: { [path]: '{ // comment\n}' } });
    const outcomes = await runSetup(planSetup({ ...options, claude: false }, deps), options);
    expect(outcomes.at(-1)).toMatchObject({ status: 'skipped' });
    expect(outcomes.at(-1)?.message).toContain('"aip"');
    expect(files.get(path)).toBe('{ // comment\n}');
  });

  it('leaves opencode.jsonc alone', async () => {
    const { deps, files } = fake({ files: { [`${path}c`]: '{}' } });
    const outcomes = await runSetup(planSetup({ ...options, claude: false }, deps), options);
    expect(outcomes.at(-1)?.status).toBe('skipped');
    expect(files.has(path)).toBe(false);
  });

  it('is skipped without opencode', async () => {
    const { deps, files } = fake({ missing: ['opencode'] });
    const outcomes = await runSetup(planSetup({ ...options, claude: false }, deps), options);
    expect(outcomes.at(-1)?.status).toBe('skipped');
    expect(files.size).toBe(0);
  });
});

describe('claude actions', () => {
  it('registers the server and installs the plugin', async () => {
    const { deps, calls } = fake({
      exec: (args) =>
        (args[0] === 'mcp' && args[1] === 'get') || args[1] === 'list'
          ? { ...ok, code: args[1] === 'list' ? 0 : 1 }
          : ok,
    });
    const outcomes = await runSetup(planSetup({ ...options, opencode: false }, deps), options);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['configured', 'done', 'done']);
    expect(calls).toContainEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'aip',
      '--',
      process.execPath,
      '/opt/aip/dist/cli/main.js',
      'mcp',
    ]);
    expect(calls).toContainEqual(['plugin', 'marketplace', 'add', '/opt/aip']);
    expect(calls).toContainEqual(['plugin', 'install', 'aip@aip']);
  });

  it('updates the plugin when Claude Code holds an older version', async () => {
    const { deps, calls } = fake({
      files: {
        '/opt/aip/integrations/claude-code/.claude-plugin/plugin.json': '{"version":"0.2.0"}',
      },
      exec: (args) =>
        args[0] === 'plugin' && args[1] === 'list'
          ? { ...ok, stdout: '  aip@aip\n    Version: 0.1.0\n    Scope: user\n' }
          : ok,
    });
    const outcomes = await runSetup(planSetup({ ...options, opencode: false }, deps), options);
    expect(outcomes.find((outcome) => outcome.id === 'claude-plugin')?.status).toBe('done');
    expect(calls).toContainEqual(['plugin', 'marketplace', 'update', 'aip']);
    expect(calls).toContainEqual(['plugin', 'update', 'aip@aip']);
    expect(calls).not.toContainEqual(['plugin', 'install', 'aip@aip']);
  });

  it('leaves the plugin alone when the installed version is current', async () => {
    const { deps, calls } = fake({
      files: {
        '/opt/aip/integrations/claude-code/.claude-plugin/plugin.json': '{"version":"0.1.0"}',
      },
      exec: (args) =>
        args[0] === 'plugin' && args[1] === 'list'
          ? { ...ok, stdout: '  aip@aip\n    Version: 0.1.0\n' }
          : ok,
    });
    const outcomes = await runSetup(planSetup({ ...options, opencode: false }, deps), options);
    expect(outcomes.find((outcome) => outcome.id === 'claude-plugin')?.status).toBe('configured');
    expect(calls.filter((args) => args[0] === 'plugin' && args[1] !== 'list')).toEqual([]);
  });

  it('does not change anything on a dry run', async () => {
    const { deps, calls } = fake();
    const outcomes = await runSetup(planSetup(options, deps), { dryRun: true, force: false });
    expect(outcomes.filter((outcome) => outcome.status === 'planned')).toHaveLength(2);
    expect(calls.filter((args) => args[1] === 'add' || args[1] === 'install')).toEqual([]);
  });

  it('skips the plugin when claude plugin is unknown, with the manual command', async () => {
    const { deps } = fake({
      exec: (args) =>
        args[0] === 'plugin' ? { code: 1, stdout: '', stderr: 'unknown command' } : ok,
    });
    const outcomes = await runSetup(planSetup({ ...options, opencode: false }, deps), options);
    const plugin = outcomes.find((outcome) => outcome.id === 'claude-plugin');
    expect(plugin?.status).toBe('skipped');
    expect(plugin?.message).toContain('claude plugin install aip@aip');
  });

  it('reports a failure of one action and still runs the next', async () => {
    const { deps } = fake({
      exec: (args) =>
        args[0] === 'mcp' && args[1] === 'get'
          ? { code: 1, stdout: '', stderr: '' }
          : args[1] === 'add'
            ? { code: 1, stdout: '', stderr: 'boom' }
            : ok,
    });
    const outcomes = await runSetup(planSetup(options, deps), options);
    expect(outcomes.find((outcome) => outcome.id === 'claude-mcp')).toMatchObject({
      status: 'failed',
    });
    expect(outcomes.find((outcome) => outcome.id === 'claude-mcp')?.message).toContain('boom');
    expect(outcomes.find((outcome) => outcome.id === 'opencode-mcp')?.status).toBe('done');
  });

  it('honors the --no-* flags', () => {
    const { deps } = fake();
    expect(
      planSetup({ ...options, claude: false, opencode: false }, deps).map((action) => action.id),
    ).toEqual(['prerequisites']);
    expect(planSetup({ ...options, plugin: false }, deps).map((action) => action.id)).toEqual([
      'prerequisites',
      'claude-mcp',
      'opencode-mcp',
    ]);
  });
});
