import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseYaml } from '../../../src/feature/swarm-config/repositories/config-files.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  ConfigService,
  configPaths,
  loadConfig,
  loadQueueSettings,
  validateQueueSection,
} from '../../../src/feature/swarm-config/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-queue-settings-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('queue settings', () => {
  it('default to the project mode and five specialists', () => {
    const paths = temporaryPaths();
    expect(loadQueueSettings(paths)).toEqual({
      scope: 'project',
      max: 5,
      pools: [],
      defaultPool: null,
    });
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadQueueSettings(paths)).toEqual({
      scope: 'project',
      max: 5,
      pools: [],
      defaultPool: null,
    });
  });

  it('are read from the global file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'queue: { scope: global, max: 3 }\n');
    expect(loadQueueSettings(paths)).toEqual({
      scope: 'global',
      max: 3,
      pools: [],
      defaultPool: null,
    });
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.queueSettings()).toEqual({
      scope: 'global',
      max: 3,
      pools: [],
      defaultPool: null,
    });
  });

  it('name the path of a wrong mode, a wrong limit and an unknown key', () => {
    expect(validateQueueSection({ scope: 'all' }).errors.map((e) => e.path)).toEqual([
      'swarm.queue.scope',
    ]);
    expect(validateQueueSection({ max: 0 }).errors.map((e) => e.path)).toEqual(['swarm.queue.max']);
    expect(validateQueueSection({ max: 33 }).errors.map((e) => e.path)).toEqual([
      'swarm.queue.max',
    ]);
    expect(validateQueueSection({ max: 1.5 }).errors.map((e) => e.path)).toEqual([
      'swarm.queue.max',
    ]);
    expect(validateQueueSection({ color: 1 }).errors.map((e) => e.path)).toEqual([
      'swarm.queue.color',
    ]);
    expect(validateQueueSection({ scope: 'global', max: 32 }).errors).toEqual([]);
  });

  it('keep the project mode when the section is wrong, and the service gives the error', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'queue: { scope: all }\n');
    expect(() => loadQueueSettings(paths)).toThrow(ConfigLoadError);
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.queueSettings()).toContain('invalid swarm.queue');
  });

  it('are an error in the project settings file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    write(join(paths.project.directory, 'settings.yaml'), 'queue: { scope: global }\n');
    try {
      loadConfig(paths);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      const errors = detail.kind === 'invalid' ? detail.errors : [];
      expect(errors).toContainEqual({
        file: join(paths.project.directory, 'settings.yaml'),
        path: 'swarm.queue',
        message: 'queue is set only in the global aip/ directory',
      });
    }
    expect(loadQueueSettings(paths).scope).toBe('project');
  });
});

const POOLS = `queue:
  max: 5
  pools:
    claude: { max: 2, members: [claude] }
    mix: { max: 2, members: ["opencode:google/*", "opencode:openai/*"] }
    glm: { max: 1, members: ["opencode:zai/*"] }
  default_pool: { max: 1 }
`;

describe('queue pools', () => {
  it('accept the split 2/2/1 with a default pool', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), POOLS);
    expect(loadQueueSettings(paths)).toEqual({
      scope: 'project',
      max: 5,
      pools: [
        { name: 'claude', max: 2, members: ['claude'] },
        { name: 'mix', max: 2, members: ['opencode:google/*', 'opencode:openai/*'] },
        { name: 'glm', max: 1, members: ['opencode:zai/*'] },
      ],
      defaultPool: { max: 1 },
    });
  });

  it('are off without `pools`, and the default pool is not allowed alone', () => {
    expect(validateQueueSection({ max: 3 }).queue.pools).toEqual([]);
    const alone = validateQueueSection({ default_pool: { max: 1 } });
    expect(alone.errors.map((e) => e.path)).toEqual(['swarm.queue.default_pool']);
    expect(alone.queue.defaultPool).toBeNull();
  });

  it('require the default pool when pools are set', () => {
    const result = validateQueueSection({ pools: { a: { max: 1, members: ['claude'] } } });
    expect(result.errors.map((e) => e.path)).toEqual(['swarm.queue.default_pool']);
    expect(result.queue.pools).toEqual([]);
  });

  it('name the path of every wrong field', () => {
    const paths = (value: unknown) => validateQueueSection(value).errors.map((error) => error.path);
    const wrap = (pool: unknown) => ({ pools: { a: pool }, default_pool: { max: 1 } });
    expect(paths(wrap({ max: 0, members: ['claude'] }))).toEqual(['swarm.queue.pools.a.max']);
    expect(paths(wrap({ max: 33, members: ['claude'] }))).toEqual(['swarm.queue.pools.a.max']);
    expect(paths(wrap({ max: 1.5, members: ['claude'] }))).toEqual(['swarm.queue.pools.a.max']);
    expect(paths(wrap({ max: 1, members: [] }))).toEqual(['swarm.queue.pools.a.members']);
    expect(paths(wrap({ max: 1 }))).toEqual(['swarm.queue.pools.a.members']);
    expect(paths(wrap({ members: ['claude'] }))).toEqual(['swarm.queue.pools.a.max']);
    expect(paths(wrap({ max: 1, members: ['claude'], color: 1 }))).toEqual([
      'swarm.queue.pools.a.color',
    ]);
    expect(paths(wrap({ max: 1, members: ['gemini'] }))).toEqual([
      'swarm.queue.pools.a.members[0]',
    ]);
    expect(paths(wrap({ max: 1, members: ['opencode:google'] }))).toEqual([
      'swarm.queue.pools.a.members[0]',
    ]);
    expect(paths(wrap({ max: 1, members: ['opencode:google/'] }))).toEqual([
      'swarm.queue.pools.a.members[0]',
    ]);
    expect(paths(wrap({ max: 1, members: ['claude', 'claude'] }))).toEqual([
      'swarm.queue.pools.a.members[1]',
    ]);
    expect(paths({ pools: {}, default_pool: { max: 1 } })).toEqual(['swarm.queue.pools']);
    expect(
      paths({ pools: { a: { max: 1, members: ['claude'] } }, default_pool: { max: 0 } }),
    ).toEqual(['swarm.queue.default_pool.max']);
    expect(
      paths({ pools: { a: { max: 1, members: ['claude'] } }, default_pool: { max: 1, x: 1 } }),
    ).toEqual(['swarm.queue.default_pool.x']);
  });

  it('refuse a selector that two pools can both match, whatever the order', () => {
    const clash = (first: string, second: string) =>
      validateQueueSection({
        pools: {
          a: { max: 1, members: [first] },
          b: { max: 1, members: [second] },
        },
        default_pool: { max: 1 },
      }).errors.map((error) => error.path);
    expect(clash('opencode:google/*', 'opencode:google/gemini-2')).toEqual([
      'swarm.queue.pools.b.members[0]',
    ]);
    expect(clash('opencode:google/gemini-2', 'opencode:google/*')).toEqual([
      'swarm.queue.pools.b.members[0]',
    ]);
    expect(clash('opencode:google/*', 'opencode:google/gem*')).toEqual([
      'swarm.queue.pools.b.members[0]',
    ]);
    expect(clash('claude', 'claude')).toEqual(['swarm.queue.pools.b.members[0]']);
    expect(clash('opencode:google/*', 'opencode:openai/*')).toEqual([]);
    expect(clash('opencode', 'opencode:google/*')).toEqual([]);
    expect(clash('opencode:Google/*', 'opencode:google/*')).toEqual([]);
  });

  it('are dropped whole, with the project mode, when the section is wrong', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'settings.yaml'),
      'queue:\n  pools:\n    a: { max: 0, members: [claude] }\n  default_pool: { max: 1 }\n',
    );
    expect(() => loadQueueSettings(paths)).toThrow(ConfigLoadError);
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.queueSettings()).toContain('swarm.queue.pools.a.max');
  });

  it('are an error in the project file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), POOLS);
    write(join(paths.project.directory, 'settings.yaml'), POOLS);
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });
});

describe('the example of the queue section in the docs', () => {
  it('passes the check of the section', () => {
    const text = readFileSync(
      join(import.meta.dirname, '../../../docs/configuration/README.md'),
      'utf8',
    );
    const block = /```yaml\n(queue:\n[\s\S]*?)```/.exec(text)?.[1];
    expect(block).toContain('pools:');
    const { queue, errors } = validateQueueSection(
      (parseYaml(block!, 'docs') as { queue: unknown }).queue,
    );
    expect(errors).toEqual([]);
    expect(queue.pools.map((pool) => pool.name)).toEqual(['claude', 'mix', 'glm']);
    expect(queue.defaultPool).toEqual({ max: 1 });
  });
});
