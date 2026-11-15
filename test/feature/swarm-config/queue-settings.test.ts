import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
    expect(loadQueueSettings(paths)).toEqual({ scope: 'project', max: 5 });
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadQueueSettings(paths)).toEqual({ scope: 'project', max: 5 });
  });

  it('are read from the global file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'queue: { scope: global, max: 3 }\n');
    expect(loadQueueSettings(paths)).toEqual({ scope: 'global', max: 3 });
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.queueSettings()).toEqual({ scope: 'global', max: 3 });
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
