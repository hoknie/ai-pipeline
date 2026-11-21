import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  configPaths,
  loadConfigSources,
  loadGlobalConfigSources,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type FieldError,
  type ResolvedConfig,
  defaultProviderOf,
  withConfigDefaults,
} from '../../../src/feature/swarm-config/types/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-default-provider-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function errorsOf(run: () => unknown): FieldError[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  return [];
}

const PROVIDERS = `  providers:
    zai:
      name: Z.ai
      access: [{ kind: cli, runtime: claude }]
    off:
      name: Off
      enabled: false
      access: [{ kind: cli, runtime: claude }]
`;

const provider = (name: string): string =>
  `name: ${name}\naccess: [{ kind: cli, runtime: claude }]\n`;

describe('default_provider', () => {
  it('is empty without the key', () => {
    expect(parseConfig(`swarm:\n${PROVIDERS}`).defaultProvider).toBeNull();
  });

  it('names a provider of the registry', () => {
    const config = parseConfig(`swarm:\n  default_provider: zai\n${PROVIDERS}`);
    expect(config.defaultProvider?.slug).toBe('zai');
    expect(defaultProviderOf(config)).toBe('zai');
  });

  it('refuses an unknown provider with the path and the known ones', () => {
    const errors = errorsOf(() => parseConfig(`swarm:\n  default_provider: nope\n${PROVIDERS}`));
    const message = errors.find((error) => error.path === 'swarm.default_provider')?.message;
    expect(message).toContain('unknown provider `nope`');
    expect(message).toContain('zai');
  });

  it('refuses an empty value', () => {
    const errors = errorsOf(() => parseConfig(`swarm:\n  default_provider: ''\n${PROVIDERS}`));
    expect(errors.map((error) => error.path)).toContain('swarm.default_provider');
  });

  it('is not substituted when the provider is disabled', () => {
    const config = parseConfig(`swarm:\n  default_provider: off\n${PROVIDERS}`);
    expect(config.defaultProvider?.slug).toBe('off');
    expect(defaultProviderOf(config)).toBeNull();
  });
});

describe('default_provider of the levels', () => {
  it('takes the project value over the shared one', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'default_provider: shared\n');
    write(join(paths.global.directory, 'providers', 'shared.yaml'), provider('Shared'));
    write(join(paths.project.directory, 'settings.yaml'), 'default_provider: local\n');
    write(join(paths.project.directory, 'providers', 'local.yaml'), provider('Local'));
    const { config } = loadConfigSources(paths);
    expect(config.defaultProvider).toEqual({ slug: 'local', level: 'project' });
  });

  it('takes the shared value when the project has none', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'default_provider: shared\n');
    write(join(paths.global.directory, 'providers', 'shared.yaml'), provider('Shared'));
    write(join(paths.project.directory, 'providers', 'local.yaml'), provider('Local'));
    const { config } = loadConfigSources(paths);
    expect(config.defaultProvider).toEqual({ slug: 'shared', level: 'global' });
  });

  it('refuses a shared value that names a project provider', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'default_provider: local\n');
    write(join(paths.project.directory, 'providers', 'local.yaml'), provider('Local'));
    const errors = errorsOf(() => loadConfigSources(paths));
    const found = errors.find((error) => error.path === 'swarm.default_provider');
    expect(found?.file).toBe(join(paths.global.directory, 'settings.yaml'));
    expect(found?.message).toContain('shared provider');
  });

  it('gives the shared value when only the shared level is read', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'default_provider: shared\n');
    write(join(paths.global.directory, 'providers', 'shared.yaml'), provider('Shared'));
    write(join(paths.project.directory, 'settings.yaml'), 'default_provider: local\n');
    write(join(paths.project.directory, 'providers', 'local.yaml'), provider('Local'));
    const { config } = loadGlobalConfigSources(paths);
    expect(config.defaultProvider).toEqual({ slug: 'shared', level: 'global' });
  });
});

describe('a snapshot without defaultProvider', () => {
  it('gets null', () => {
    const stored = { ...parseConfig('swarm:\n  max: 3\n') } as Partial<ResolvedConfig>;
    delete stored.defaultProvider;
    expect(withConfigDefaults(stored as ResolvedConfig).defaultProvider).toBeNull();
  });
});
