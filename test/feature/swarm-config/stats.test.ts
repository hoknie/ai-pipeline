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
  loadStatsSettings,
  validateStatsSection,
} from '../../../src/feature/swarm-config/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-stats-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('stats settings', () => {
  it('default to collection on, nothing excluded and the cost shown', () => {
    const paths = temporaryPaths();
    expect(loadStatsSettings(paths)).toEqual({ enabled: true, exclude: [], showCost: true });
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadStatsSettings(paths).enabled).toBe(true);
  });

  it('are read from the global file whatever else is wrong', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'settings.yaml'),
      'max: 100\nstats:\n  enabled: false\n  exclude: [/work/app]\n  show_cost: false\n',
    );
    expect(loadStatsSettings(paths)).toEqual({
      enabled: false,
      exclude: ['/work/app'],
      showCost: false,
    });
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('name the path of a wrong type and of an empty path', () => {
    expect(validateStatsSection({ enabled: 'yes' }).errors.map((e) => e.path)).toEqual([
      'swarm.stats.enabled',
    ]);
    expect(validateStatsSection({ exclude: ['', '/work/app'] }).errors.map((e) => e.path)).toEqual([
      'swarm.stats.exclude[0]',
    ]);
    expect(validateStatsSection({ exclude: '/work/app' }).errors.map((e) => e.path)).toEqual([
      'swarm.stats.exclude',
    ]);
    expect(validateStatsSection({ show_cost: 1, color: 1 }).errors.map((e) => e.path)).toEqual([
      'swarm.stats.color',
      'swarm.stats.show_cost',
    ]);
    expect(validateStatsSection({ enabled: true, exclude: ['/a'] }).errors).toEqual([]);
  });

  it('fail to load with the field path, and the service answers with the text of the error', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'stats: { enabled: "yes" }\n');
    expect(() => loadStatsSettings(paths)).toThrow(ConfigLoadError);
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.statsSettings()).toContain('invalid swarm.stats');
  });

  it('are returned by the config service from the shared settings.yaml', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'stats: { exclude: [/work/lib] }\n');
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.statsSettings()).toEqual({
      enabled: true,
      exclude: ['/work/lib'],
      showCost: true,
    });
  });

  it('are an error in the project settings file, and collection stays on', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    write(join(paths.project.directory, 'settings.yaml'), 'stats: { enabled: false }\n');
    try {
      loadConfig(paths);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      const errors = detail.kind === 'invalid' ? detail.errors : [];
      expect(errors).toContainEqual({
        file: join(paths.project.directory, 'settings.yaml'),
        path: 'swarm.stats',
        message: 'stats is set only in the global aip/ directory',
      });
    }
    expect(loadStatsSettings(paths).enabled).toBe(true);
  });
});
