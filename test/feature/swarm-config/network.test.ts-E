import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  type ConfigPaths,
  type FieldError,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  ConfigService,
  configPaths,
  loadConfig,
  loadNetworkSettings,
  validateNetworkSection,
} from '../../../src/feature/swarm-config/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-network-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function errorsOf(value: unknown): FieldError[] {
  return validateNetworkSection(value).errors;
}

describe('network settings', () => {
  it('default to a disabled check of the API of Anthropic', () => {
    const paths = temporaryPaths();
    expect(loadNetworkSettings(paths)).toEqual({
      enabled: false,
      targets: ['https://api.anthropic.com'],
      interfaces: [],
      proxy: null,
      interval: 30,
      timeout: 5,
    });
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    expect(loadNetworkSettings(paths).enabled).toBe(false);
  });

  it('are read from the global file whatever else is wrong', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'settings.yaml'),
      'max: 100\nnetwork:\n  enabled: true\n  interfaces: [wt0]\n  proxy: http://user:pw@127.0.0.1:3128\n  interval: 10\n  timeout: 2\n  targets: ["127.0.0.1:80", "http://localhost:1/x"]\n',
    );
    expect(loadNetworkSettings(paths)).toEqual({
      enabled: true,
      targets: ['127.0.0.1:80', 'http://localhost:1/x'],
      interfaces: ['wt0'],
      proxy: 'http://user:pw@127.0.0.1:3128',
      interval: 10,
      timeout: 2,
    });
    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('name the path of a wrong target', () => {
    expect(errorsOf({ enabled: true, targets: ['api.anthropic.com'] })).toEqual([
      { path: 'swarm.network.targets[0]', message: 'must be host:port or an http(s):// URL' },
    ]);
    expect(
      errorsOf({ targets: ['ok:80', 'host:0', 'host:70000', 'ftp://x'] }).map((e) => e.path),
    ).toEqual(['swarm.network.targets[1]', 'swarm.network.targets[2]', 'swarm.network.targets[3]']);
  });

  it('check the bounds of interval and timeout', () => {
    expect(errorsOf({ interval: 4 }).map((e) => e.path)).toEqual(['swarm.network.interval']);
    expect(errorsOf({ interval: 3601 }).map((e) => e.path)).toEqual(['swarm.network.interval']);
    expect(errorsOf({ timeout: 0 }).map((e) => e.path)).toEqual(['swarm.network.timeout']);
    expect(errorsOf({ timeout: 61 }).map((e) => e.path)).toEqual(['swarm.network.timeout']);
    expect(errorsOf({ interval: 5, timeout: 60 })).toEqual([]);
  });

  it('check the proxy, types and unknown keys', () => {
    expect(errorsOf({ proxy: 'socks5://x:1' }).map((e) => e.path)).toEqual(['swarm.network.proxy']);
    expect(errorsOf({ enabled: 'yes', color: 1 }).map((e) => e.path)).toEqual([
      'swarm.network.color',
      'swarm.network.enabled',
    ]);
  });

  it('fail to load with the global file and the field path when wrong', () => {
    const paths = temporaryPaths();
    const file = join(paths.global.directory, 'settings.yaml');
    write(file, 'network: { interval: 1 }\n');
    expect(() => loadNetworkSettings(paths)).toThrow(ConfigLoadError);
    const service = new ConfigService({
      environment: { XDG_CONFIG_HOME: join(paths.global.directory, '..') },
    });
    expect(service.networkSettings()).toContain('invalid swarm.network');
  });

  it('are an error in the project settings file', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'max: 2\n');
    write(join(paths.project.directory, 'settings.yaml'), 'network: { enabled: true }\n');
    try {
      loadConfig(paths);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      const errors = detail.kind === 'invalid' ? detail.errors : [];
      expect(errors).toContainEqual({
        file: join(paths.project.directory, 'settings.yaml'),
        path: 'swarm.network',
        message: 'network is set only in the global aip/ directory',
      });
    }
  });
});
