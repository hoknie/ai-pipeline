import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  configPaths,
  loadConfigSources,
  loadGlobalConfigSources,
} from '../../../src/feature/swarm-config/services/index.ts';

it.each(['global', 'project'] as const)(
  'loads an empty registry with only %s chains, even beside a legacy file',
  (level) => {
    const root = mkdtempSync(join(tmpdir(), 'aip-registry-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    const directory = paths[level].directory;
    mkdirSync(join(directory, 'chains'), { recursive: true });
    writeFileSync(
      join(directory, 'chains', 'fixed.yaml'),
      'name: Fixed\nmode: on_error\nruntimes: [{ runtime: claude, model: A }]\n',
    );
    const check = () => {
      expect(loadConfigSources(paths, true).config.providers).toEqual([]);
      expect(loadConfigSources(paths, true).files).toEqual([]);
      expect(loadConfigSources(paths).config.chains[0]?.runtimes[0]?.model).toBe('A');
      if (level === 'global') {
        expect(loadGlobalConfigSources(paths, true).config.providers).toEqual([]);
        expect(loadGlobalConfigSources(paths).config.chains[0]?.runtimes[0]?.model).toBe('A');
      }
    };
    check();
    const legacy = paths[level].legacy[0]!;
    mkdirSync(join(legacy, '..'), { recursive: true });
    writeFileSync(legacy, 'broken: *unknown');
    check();
    // The registry still must not decode chains merely to test their presence.
    writeFileSync(join(directory, 'chains', 'fixed.yaml'), 'value: *unknown');
    expect(loadConfigSources(paths, true).config.providers).toEqual([]);
    expect(() => loadConfigSources(paths)).toThrow('Unresolved alias');
    if (level === 'global')
      expect(loadGlobalConfigSources(paths, true).config.providers).toEqual([]);
  },
);

it('rejects a shared default constructor provider defined only in the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'aip-registry-'));
  const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
  for (const level of ['global', 'project'] as const) {
    mkdirSync(join(paths[level].directory, 'providers'), { recursive: true });
    writeFileSync(
      join(
        paths[level].directory,
        'providers',
        `${level === 'global' ? 'other' : 'constructor'}.yaml`,
      ),
      'name: Provider\naccess: [{ kind: cli, runtime: claude }]\n',
    );
  }
  const settings = join(paths.global.directory, 'settings.yaml');
  writeFileSync(settings, 'default_provider: constructor\n');
  for (const registryOnly of [false, true]) {
    const load = () => loadConfigSources(paths, registryOnly);
    expect(load).toThrow(settings);
    expect(load).toThrow('swarm.default_provider');
    expect(load).toThrow('must be a shared provider');
  }
});

it.each(['global', 'project'] as const)(
  'rejects ambiguous %s settings in the registry with file diagnostics',
  (level) => {
    const root = mkdtempSync(join(tmpdir(), 'aip-registry-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    mkdirSync(paths[level].directory, { recursive: true });
    const yaml = join(paths[level].directory, 'settings.yaml');
    const yml = join(paths[level].directory, 'settings.yml');
    writeFileSync(yaml, 'roles: { think: { name: Think } }\n');
    writeFileSync(yml, 'roles: { code: { name: Code } }\n');
    const load = () => loadConfigSources(paths, true);
    expect(load).toThrow(yaml);
    expect(load).toThrow(yml);
    expect(load).toThrow('defined by two files');
    expect(() => loadConfigSources(paths)).toThrow('defined by two files');
    if (level === 'global') {
      expect(() => loadGlobalConfigSources(paths, true)).toThrow(yaml);
      expect(() => loadGlobalConfigSources(paths, true)).toThrow(yml);
    }
  },
);

it.each(['global', 'project'] as const)(
  'does not decode unrelated %s sections for the registry',
  (level) => {
    const root = mkdtempSync(join(tmpdir(), 'aip-registry-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    const directory = paths[level].directory;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), 'roles: { think: { name: Think } }\n');
    for (const section of ['chains', 'specialists', 'pipelines', 'actions']) {
      mkdirSync(join(directory, section));
      writeFileSync(join(directory, section, 'broken.yaml'), 'value: *unknown');
    }
    const loaded = loadConfigSources(paths, true);
    expect(loaded.config.roles.map((role) => role.slug)).toEqual(['think']);
    expect(loaded.files).toEqual([join(directory, 'settings.yaml')]);
    expect(() => loadConfigSources(paths)).toThrow('Unresolved alias');
    if (level === 'global') {
      expect(loadGlobalConfigSources(paths, true).files).toEqual(loaded.files);
      expect(() => loadGlobalConfigSources(paths)).toThrow('Unresolved alias');
    }
  },
);
