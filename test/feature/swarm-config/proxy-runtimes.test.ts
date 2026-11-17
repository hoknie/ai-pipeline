import { describe, expect, it } from 'vitest';

import {
  configFromFiles,
  validateObserverProfile,
} from '../../../src/feature/swarm-config/services/index.ts';
import { validateQueueSection } from '../../../src/feature/swarm-config/services/index.ts';
import { RUNTIMES, withConfigDefaults } from '../../../src/feature/swarm-config/types/index.ts';

const NEW = ['codex', 'kilo', 'cline', 'copilot'] as const;

describe.each(NEW)('%s configuration', (runtime) => {
  it('is a runtime of specialists, defaults, naming and the observer, never the default', () => {
    const config = configFromFiles({
      settings: `defaults: { runtime: ${runtime} }\nnaming: { runtime: ${runtime}, model: m }`,
      specialists: { coder: 'name: C\nmodel: team-model' },
    });
    expect(config.specialists[0]).toMatchObject({ runtime, model: 'team-model' });
    expect(config.naming).toMatchObject({ runtime, model: 'm' });
    expect(config.runtimes[runtime]).toEqual({
      command: runtime,
      enabled: null,
      args: [],
      env: {},
    });
    expect(validateObserverProfile({ runtime }).errors).toEqual([]);
    expect(configFromFiles({ specialists: { coder: 'name: C' } }).specialists[0]?.runtime).toBe(
      'claude',
    );
  });

  it('is accepted as an item of a chain and as a selector of a queue pool', () => {
    const config = configFromFiles({
      chains: {
        one: `name: One\nmode: on_error\nruntimes:\n  - { runtime: ${runtime}, model: m }\n`,
      },
      specialists: { coder: 'name: C\nruntime_chain: one' },
    });
    expect(config.chains[0]?.runtimes[0]).toMatchObject({ runtime, model: 'm' });
    const queue = validateQueueSection({
      pools: { a: { max: 1, members: [runtime] } },
      default_pool: { max: 2 },
    });
    expect(queue.errors).toEqual([]);
    expect(queue.queue.pools[0]?.members).toEqual([runtime]);
    expect(
      validateQueueSection({
        pools: { a: { max: 1, members: ['cursor'] } },
        default_pool: { max: 1 },
      }).errors[0]?.message,
    ).toContain('must be a runtime name');
  });

  it.each(['variant: high', 'reasoning_effort: high'])('rejects OpenCode-only %s', (field) => {
    expect(() =>
      configFromFiles({ specialists: { coder: `name: C\nruntime: ${runtime}\n${field}` } }),
    ).toThrow('is supported by the opencode runtime only');
  });
});

describe('the list of runtimes', () => {
  it('names the old three first and the four CLIs after them, without cursor or gemini', () => {
    expect(RUNTIMES).toEqual(['claude', 'opencode', 'agy', ...NEW]);
    expect(() => configFromFiles({ specialists: { coder: 'name: C\nruntime: cursor' } })).toThrow();
    expect(() => configFromFiles({ specialists: { coder: 'name: C\nruntime: gemini' } })).toThrow();
  });

  it('fills the four commands into a snapshot of an older build without changing its runtime', () => {
    const config = configFromFiles({
      specialists: { coder: 'name: C\nruntime: opencode\nmodel: p/m' },
    });
    const stored = structuredClone(config) as unknown as { runtimes?: Record<string, unknown> };
    stored.runtimes = {
      claude: { command: '/c', enabled: true, args: [], env: {} },
      opencode: { command: 'opencode', enabled: null, args: [], env: {} },
      agy: { command: 'agy', enabled: null, args: [], env: {} },
    };
    const restored = withConfigDefaults(stored as never);
    expect(restored.runtimes.claude.command).toBe('/c');
    expect(restored.runtimes.codex).toEqual({ command: 'codex', enabled: null, args: [], env: {} });
    expect(restored.specialists[0]?.runtime).toBe('opencode');
    expect(Object.keys(restored.runtimes)).toEqual([...RUNTIMES]);
  });
});
