import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadConfigSources,
  configPaths,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type FieldError,
  type Provider,
  type ResolvedConfig,
  knownProviders,
  providerName,
  providerProblem,
  roleModelOf,
  unknownProviderMessage,
  withConfigDefaults,
} from '../../../src/feature/swarm-config/types/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-providers-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function errorsOf(text: string): FieldError[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  return [];
}

function errorsOfPaths(paths: ConfigPaths): FieldError[] {
  try {
    loadConfigSources(paths);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  return [];
}

const ROLES = `  roles:
    think: { name: Think }
    code: { name: Code }
`;

const ZAI = `    zai:
      name: Z.ai
      access: [{ kind: cli, runtime: opencode, model_prefix: gproxy/glmcode }]
      models: { think: GLM-5.3, code: GLM-5.3-Flash }
`;

const config = (providers: string, roles = ROLES): string =>
  `swarm:\n${roles}  providers:\n${providers}`;

function expectError(errors: FieldError[], path: string, fragment = ''): void {
  expect(errors.find((error) => error.path === path)?.message ?? `no error at ${path}`).toContain(
    fragment,
  );
}

describe('roles', () => {
  it('are empty without a roles key', () => {
    expect(parseConfig('swarm:\n  max: 3\n').roles).toEqual([]);
  });

  it('keep the order of the file and the human names', () => {
    const roles = parseConfig(`swarm:\n${ROLES}`).roles;
    expect(roles.map((role) => [role.slug, role.name])).toEqual([
      ['think', 'Think'],
      ['code', 'Code'],
    ]);
  });

  it('require a name and refuse a bad slug and unknown keys', () => {
    const errors = errorsOf(
      'swarm:\n  roles:\n    think: {}\n    Bad: { name: x }\n    code: { name: y, color: red }\n',
    );
    expectError(errors, 'swarm.roles.think.name', 'is required');
    expectError(errors, 'swarm.roles.Bad', 'slug must match');
    expectError(errors, 'swarm.roles.code.color', 'unknown key');
  });

  it('merge by slug: the project overrides the shared role and adds new ones after', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'settings.yaml'),
      'roles:\n  think: { name: Думать }\n  code: { name: Кодить }\n',
    );
    write(
      join(paths.project.directory, 'settings.yaml'),
      'roles:\n  code: { name: Писать код }\n  light: { name: Лёгкое }\n',
    );
    const { config: loaded } = loadConfigSources(paths);
    expect(loaded.roles.map((role) => [role.slug, role.name, role.level])).toEqual([
      ['think', 'Думать', 'global'],
      ['code', 'Писать код', 'project'],
      ['light', 'Лёгкое', 'project'],
    ]);
  });
});

describe('a provider file', () => {
  it('is valid with a name, an access and models of known roles', () => {
    const loaded = parseConfig(config(ZAI));
    const [provider] = loaded.providers;
    expect(provider).toMatchObject({ slug: 'zai', name: 'Z.ai', enabled: true });
    expect(provider?.models.think).toEqual({ model: 'GLM-5.3' });
    expect(provider?.access[0]).toMatchObject({
      kind: 'cli',
      runtime: 'opencode',
      modelPrefix: 'gproxy/glmcode',
      enabled: true,
    });
  });

  it('needs a name and a non-empty access', () => {
    const errors = errorsOf(
      config(
        `    local: { name: Local, access: [] }
    zai: { name: "", access: [{ kind: cli, runtime: claude }] }
    none: { name: None }
`,
      ),
    );
    expectError(errors, 'swarm.providers.local.access', 'must not be empty');
    expectError(errors, 'swarm.providers.zai.name', 'must not be empty');
    expectError(errors, 'swarm.providers.none.access', 'is required');
  });

  it('refuses a model of an unknown role and lists the known ones', () => {
    const errors = errorsOf(
      config(
        '    zai: { name: Z, access: [{ kind: cli, runtime: claude }], models: { fast: haiku } }\n',
      ),
    );
    expectError(
      errors,
      'swarm.providers.zai.models.fast',
      'unknown role `fast`; known: think, code',
    );
  });

  it('says none when no role is defined', () => {
    const errors = errorsOf(
      config(
        '    zai: { name: Z, access: [{ kind: cli, runtime: claude }], models: { a: b } }\n',
        '',
      ),
    );
    expectError(errors, 'swarm.providers.zai.models.a', 'known: none');
  });

  it('leaves an empty cell without an error', () => {
    const loaded = parseConfig(
      config(
        '    zai: { name: Z, access: [{ kind: cli, runtime: claude }], models: { think: opus } }\n',
      ),
    );
    expect(Object.keys(loaded.providers[0]!.models)).toEqual(['think']);
  });

  it('takes options of a model only with an opencode access', () => {
    const ok = parseConfig(
      config(
        `    openai:
      name: OpenAI
      access: [{ kind: cli, runtime: opencode, model_prefix: openai }]
      models: { think: { model: gpt-6.1-sol, reasoning_effort: xhigh, variant: high } }
`,
      ),
    );
    expect(ok.providers[0]!.models.think).toEqual({
      model: 'gpt-6.1-sol',
      reasoningEffort: 'xhigh',
      variant: 'high',
    });
    const errors = errorsOf(
      config(
        `    anthropic:
      name: Anthropic
      access: [{ kind: cli, runtime: claude }]
      models: { think: { model: opus, variant: high } }
`,
      ),
    );
    expectError(errors, 'swarm.providers.anthropic.models.think.variant');
  });
});

describe('an access of a provider', () => {
  const only = (access: string, extra = ''): string =>
    config(`    p: { name: P, access: [${access}]${extra} }\n`);

  it('is cli with a runtime, or api', () => {
    const loaded = parseConfig(
      only(
        '{ kind: api, endpoint: { base_url: "https://api.openai.com/v1", key_env: OPENAI_API_KEY } }, { kind: cli, runtime: opencode, model_prefix: openai }',
      ),
    );
    expect(loaded.providers[0]!.access.map((access) => access.kind)).toEqual(['api', 'cli']);
  });

  it('refuses an unknown kind, listing cli and api', () => {
    expectError(errorsOf(only('{ kind: http }')), 'swarm.providers.p.access[0].kind', 'cli, api');
  });

  it('refuses unknown keys and a missing runtime', () => {
    const errors = errorsOf(only('{ kind: cli, color: red }, { kind: api, runtime: claude }'));
    expectError(errors, 'swarm.providers.p.access[0].color', 'unknown key');
    expectError(errors, 'swarm.providers.p.access[0].runtime', 'is required');
    expectError(errors, 'swarm.providers.p.access[1].runtime', 'unknown key');
  });

  it('takes a model_prefix only for opencode and kilo and checks its form', () => {
    const errors = errorsOf(
      only(
        '{ kind: cli, runtime: claude, model_prefix: zai }, { kind: cli, runtime: kilo, model_prefix: "/a" }, { kind: cli, runtime: opencode, model_prefix: "a b" }',
      ),
    );
    expectError(errors, 'swarm.providers.p.access[0].model_prefix', 'opencode and kilo');
    expectError(errors, 'swarm.providers.p.access[1].model_prefix', '`/`');
    expectError(errors, 'swarm.providers.p.access[2].model_prefix', 'spaces');
  });

  it('takes an endpoint with the name of a variable only for runtimes that can use it', () => {
    const ok = parseConfig(
      only(
        '{ kind: cli, runtime: codex, endpoint: { base_url: "https://llm.example/v1", key_env: LLM_KEY } }',
      ),
    );
    expect(ok.providers[0]!.access[0]).toMatchObject({
      endpoint: { baseUrl: 'https://llm.example/v1', keyEnv: 'LLM_KEY' },
    });
    const errors = errorsOf(
      only(
        '{ kind: cli, runtime: opencode, endpoint: { base_url: "https://x.example", key_env: K } }, { kind: cli, runtime: claude, endpoint: { base_url: "ftp://x", key_env: "sk-123 456" } }',
      ),
    );
    expectError(errors, 'swarm.providers.p.access[0].endpoint', 'opencode');
    expectError(errors, 'swarm.providers.p.access[1].endpoint.base_url', 'http');
    expectError(errors, 'swarm.providers.p.access[1].endpoint.key_env', 'name of an environment');
  });

  it('refuses a command that is not a name or an absolute path', () => {
    const errors = errorsOf(only('{ kind: cli, runtime: opencode, command: ./opencode }'));
    expectError(errors, 'swarm.providers.p.access[0].command', 'absolute path');
  });

  it('builds the full id from the prefix and lets an access override a role model', () => {
    const loaded = parseConfig(
      config(
        `    zai:
      name: Z.ai
      access:
        - { kind: cli, runtime: opencode, model_prefix: zai }
        - { kind: cli, runtime: claude, models: { think: glm-5.3 } }
      models: { think: GLM-5.3 }
`,
      ),
    );
    const provider = loaded.providers[0]!;
    expect(roleModelOf(provider, provider.access[0]!, 'think')).toEqual({ model: 'zai/GLM-5.3' });
    expect(roleModelOf(provider, provider.access[1]!, 'think')).toEqual({ model: 'glm-5.3' });
    expect(roleModelOf(provider, provider.access[0]!, 'code')).toBeNull();
  });

  it('checks the provider/model form of the full id of opencode', () => {
    const errors = errorsOf(
      config(
        '    zai: { name: Z, access: [{ kind: cli, runtime: opencode }], models: { code: GLM-5.3 } }\n',
      ),
    );
    expectError(errors, 'swarm.providers.zai.models.code', 'provider/model');
  });
});

describe('the registry', () => {
  const loaded = parseConfig(
    config(`    zai: { name: Z.ai, access: [{ kind: cli, runtime: claude }] }
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    off: { name: Off, enabled: false, access: [{ kind: cli, runtime: claude }] }
`),
  );

  it('is sorted by slug and keeps disabled providers', () => {
    expect(knownProviders(loaded).map((provider) => provider.slug)).toEqual([
      'anthropic',
      'off',
      'zai',
    ]);
  });

  it('names the known providers in the error of an unknown one', () => {
    expect(providerProblem(loaded, 'openai')).toBe(
      'unknown provider `openai`; known: anthropic (Anthropic), off (Off), zai (Z.ai)',
    );
    expect(unknownProviderMessage({ providers: [] }, 'x')).toBe(
      'unknown provider `x`; known: none',
    );
  });

  it('refuses a disabled provider and accepts the others', () => {
    expect(providerProblem(loaded, 'off')).toBe('provider `off` is disabled');
    expect(providerProblem(loaded, 'zai')).toBeNull();
  });

  it('gives the name of a provider or null', () => {
    expect(providerName(loaded, 'zai')).toBe('Z.ai');
    expect(providerName(loaded, 'nope')).toBeNull();
    expect(providerName({}, 'zai')).toBeNull();
  });
});

describe('the providers directory', () => {
  const file = (name: string, directory: string): string => join(directory, 'providers', name);

  it('merges shared and project providers; a project file replaces the shared one whole', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'roles:\n  think: { name: Think }\n');
    write(
      file('zai.yaml', paths.global.directory),
      'name: Z.ai\naccess: [{ kind: cli, runtime: opencode, model_prefix: zai }]\nmodels: { think: GLM-5.3 }\n',
    );
    write(
      file('anthropic.yaml', paths.global.directory),
      'name: Anthropic\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    write(
      file('zai.yaml', paths.project.directory),
      'name: Z.ai project\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    const loaded = loadConfigSources(paths);
    const byLevel = Object.fromEntries(
      loaded.config.providers.map((provider) => [provider.slug, provider]),
    );
    expect(byLevel.zai).toMatchObject({ name: 'Z.ai project', level: 'project', models: {} });
    expect(byLevel.anthropic).toMatchObject({ level: 'global' });
    const names = loaded.files.map((path) => path.slice(path.lastIndexOf('/') + 1));
    expect(names.indexOf('anthropic.yaml')).toBeGreaterThan(-1);
  });

  it('refuses the same provider as .yaml and .yml with both paths', () => {
    const paths = temporaryPaths();
    write(
      file('zai.yaml', paths.project.directory),
      'name: Z\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    write(
      file('zai.yml', paths.project.directory),
      'name: Z\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    const errors = errorsOfPaths(paths);
    expectError(errors, 'swarm.providers.zai', 'defined by two files');
    expect(errors[0]?.message).toContain('zai.yaml');
    expect(errors[0]?.message).toContain('zai.yml');
  });

  it('takes command and args of an access only from the shared level', () => {
    const paths = temporaryPaths();
    write(
      file('zai.yaml', paths.global.directory),
      'name: Z\naccess: [{ kind: cli, runtime: opencode, command: /opt/opencode, args: [--x] }]\n',
    );
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    const shared = loadConfigSources(paths).config.providers[0]!.access[0];
    expect(shared).toMatchObject({ command: '/opt/opencode', args: ['--x'] });
    write(
      file('local.yaml', paths.project.directory),
      'name: L\naccess: [{ kind: cli, runtime: opencode, command: /opt/opencode }]\n',
    );
    const errors = errorsOfPaths(paths);
    expectError(errors, 'swarm.providers.local.access[0].command', 'only in the global');
  });

  it('refuses a provider file with a slug that is not a slug', () => {
    const paths = temporaryPaths();
    write(
      file('Bad_Name.yaml', paths.project.directory),
      'name: B\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    expectError(errorsOfPaths(paths), 'swarm.providers.Bad_Name', 'slug must match');
  });

  it('refuses providers as a key of settings.yaml', () => {
    const paths = temporaryPaths();
    write(
      join(paths.project.directory, 'settings.yaml'),
      'providers:\n  zai: { name: Z, access: [{ kind: cli, runtime: claude }] }\n',
    );
    expectError(errorsOfPaths(paths), 'swarm.providers', 'providers/ directory');
  });
});

describe('a snapshot of an older build', () => {
  it('reads without providers and roles and keeps the tier items as they were', () => {
    const current = parseConfig(
      'swarm:\n  chains:\n    thinking: { name: T, mode: on_error, runtimes: [{ runtime: claude }] }\n',
    );
    const stored = { ...current } as Partial<ResolvedConfig>;
    delete stored.providers;
    delete stored.roles;
    const restored = withConfigDefaults(stored as ResolvedConfig);
    expect(restored.providers).toEqual([]);
    expect(restored.roles).toEqual([]);
    expect(restored.chains[0]!.slug).toBe('thinking');
  });

  it('keeps the providers it has and fills the level', () => {
    const provider = { slug: 'zai', name: 'Z', enabled: true, access: [], models: {} };
    const restored = withConfigDefaults({
      ...parseConfig('swarm:\n  max: 3\n'),
      providers: [provider as unknown as Provider],
    });
    expect(restored.providers[0]).toMatchObject({ slug: 'zai', level: 'project' });
  });
});
