import { describe, expect, it } from 'vitest';

import {
  createOpencodeRuntime,
  parseOpencodeModels,
} from '../../../src/feature/agents/clients/opencode/index.ts';
import { createAgentsServices } from '../../../src/feature/agents/services/index.ts';
import { createAgyRuntime } from '../../../src/feature/agents/clients/agy/index.ts';
import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { defaultRuntimes } from '../../../src/feature/swarm-config/types/index.ts';
import type { CommandRunner } from '../../../src/feature/agents/ports/index.ts';

const failing: CommandRunner = () => Promise.reject(new Error('must not run'));

describe('parseOpencodeModels', () => {
  it('groups by provider, keeps the nested path in the name and drops banners and duplicates', () => {
    const models = parseOpencodeModels(
      [
        'Loading providers…',
        'openrouter/anthropic/claude-opus-5-5',
        'anthropic/claude-sonnet-5-5',
        'Anthropic/Zed',
        'anthropic/claude-sonnet-5-5',
        '  openai/gpt-5  ',
        '',
      ].join('\n'),
    );
    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet-5-5', name: 'claude-sonnet-5-5', group: 'anthropic' },
      { id: 'Anthropic/Zed', name: 'Zed', group: 'Anthropic' },
      { id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' },
      {
        id: 'openrouter/anthropic/claude-opus-5-5',
        name: 'anthropic/claude-opus-5-5',
        group: 'openrouter',
      },
    ]);
  });
});

describe('listModels of the runtimes', () => {
  it('runs opencode models in the directory with the arguments and environment of the runtime', async () => {
    const calls: unknown[] = [];
    const run: CommandRunner = (file, args, options) => {
      calls.push({ file, args, options });
      return Promise.resolve({ stdout: 'openai/gpt-5\n' });
    };
    const runtime = createOpencodeRuntime('/bin/opencode', { args: ['--x'], env: { A: '1' } });
    const result = await runtime.listModels('/repo', run);
    expect(result).toEqual({
      models: [{ id: 'openai/gpt-5', name: 'gpt-5', group: 'openai' }],
      error: null,
    });
    expect(calls).toEqual([
      {
        file: '/bin/opencode',
        args: ['--x', 'models'],
        options: { cwd: '/repo', env: { A: '1' }, timeout: 15_000 },
      },
    ]);
  });

  it('reports a missing opencode and a failing command as an error text', async () => {
    const missing = Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' });
    const runtime = createOpencodeRuntime('opencode');
    expect(await runtime.listModels('/repo', () => Promise.reject(missing))).toEqual({
      models: [],
      error: 'opencode: command not found',
    });
    const long = await runtime.listModels('/repo', () =>
      Promise.reject(new Error('x'.repeat(500))),
    );
    expect(long.models).toEqual([]);
    expect(long.error).toHaveLength(200);
  });

  it('lists the built-in claude models, aliases first, without running a command', async () => {
    const { models, error } = await createClaudeRuntime().listModels('/repo', failing);
    expect(error).toBeNull();
    expect(models.slice(0, 3).map((model) => model.id)).toEqual(['opus', 'sonnet', 'haiku']);
    expect(models.slice(0, 3).every((model) => model.group === 'aliases')).toBe(true);
    expect(
      models.some((model) => model.group === 'anthropic' && model.id.startsWith('claude-')),
    ).toBe(true);
  });

  it('lists nothing for agy and does not fail', async () => {
    expect(await createAgyRuntime().listModels('/repo', failing)).toEqual({
      models: [],
      error: null,
    });
  });
});

describe('AgentsService.models', () => {
  function service(results: (() => Promise<{ stdout: string }>)[]) {
    let calls = 0;
    const agents = createAgentsServices({
      environment: { FROM_DAEMON: 'yes' },
      factories: {
        claude: createClaudeRuntime,
        opencode: createOpencodeRuntime,
        agy: createAgyRuntime,
      },
      naming: { parse: () => null },
      commands: (_file, _args, options) => {
        expect(options.env.FROM_DAEMON).toBe('yes');
        const next = results[Math.min(calls, results.length - 1)]!;
        calls += 1;
        return next();
      },
    }).agents;
    return { agents, calls: () => calls };
  }
  const ok = () => Promise.resolve({ stdout: 'openai/gpt-5\n' });
  const settings = defaultRuntimes();
  for (const runtime of Object.values(settings)) runtime.enabled = true;

  it('serves a repeat from the cache, also for parallel requests, and refreshes on demand', async () => {
    const { agents, calls } = service([ok]);
    const [a, b] = await Promise.all([
      agents.models('/r', settings),
      agents.models('/r', settings),
    ]);
    expect(a).toBe(b);
    await agents.models('/r', settings);
    expect(calls()).toBe(1);
    await agents.models('/r', settings, true);
    expect(calls()).toBe(2);
    await agents.models('/other', settings);
    expect(calls()).toBe(3);
  });

  it('does not ask a disabled runtime and asks again once it is switched on', async () => {
    const { agents, calls } = service([ok]);
    const off = defaultRuntimes();
    const catalogs = await agents.models('/r', off);
    expect(catalogs.opencode).toEqual({ models: [], error: null });
    expect(catalogs.claude).toEqual({ models: [], error: null });
    expect(calls()).toBe(0);
    const on = defaultRuntimes();
    on.opencode.enabled = true;
    const next = await agents.models('/r', on);
    expect(next.opencode.models.map((model) => model.id)).toEqual(['openai/gpt-5']);
    expect(calls()).toBe(1);
  });

  it('is enabled by the field, then by a non-empty AIP_<NAME>_BIN, otherwise off', () => {
    const build = (environment: NodeJS.ProcessEnv) =>
      createAgentsServices({
        environment,
        factories: {
          claude: createClaudeRuntime,
          opencode: createOpencodeRuntime,
          agy: createAgyRuntime,
        },
        naming: { parse: () => null },
        commands: () => Promise.resolve({ stdout: '' }),
      }).agents;
    const withField = (enabled: boolean | null) => {
      const settings = defaultRuntimes();
      settings.claude.enabled = enabled;
      return settings;
    };
    expect(build({}).isEnabled('claude', withField(null))).toBe(false);
    expect(build({}).isEnabled('claude', withField(true))).toBe(true);
    expect(build({ AIP_CLAUDE_BIN: '/fake' }).isEnabled('claude', withField(null))).toBe(true);
    expect(build({ AIP_CLAUDE_BIN: '' }).isEnabled('claude', withField(null))).toBe(false);
    expect(build({ AIP_CLAUDE_BIN: '/fake' }).isEnabled('claude', withField(false))).toBe(false);
    expect(build({ AIP_CLAUDE_BIN: '/fake' }).isEnabled('opencode', withField(null))).toBe(false);
  });

  it('does not keep a failure and leaves the other runtimes alone', async () => {
    const { agents, calls } = service([() => Promise.reject(new Error('down')), ok]);
    const first = await agents.models('/r', settings);
    expect(first.opencode).toEqual({ models: [], error: 'down' });
    expect(first.claude.models.length).toBeGreaterThan(0);
    await Promise.resolve();
    const second = await agents.models('/r', settings);
    expect(calls()).toBe(2);
    expect(second.opencode.models.map((model) => model.id)).toEqual(['openai/gpt-5']);
    await agents.models('/r', settings);
    expect(calls()).toBe(2);
  });
});
