import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  configPaths,
  loadConfig,
  loadGlobalConfigSources,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';
import { ConfigLoadError, type FieldError } from '../../../src/feature/swarm-config/types/index.ts';

const registry = `
  roles:
    code: { name: Code }
    empty: { name: Empty }
  providers:
    gateway:
      name: Gateway
      models:
        code: { model: base, variant: inherited, reasoning_effort: high }
      access:
        - { kind: cli, runtime: opencode, model_prefix: proxy }
        - { kind: cli, runtime: claude }
        - { kind: cli, runtime: agy }
`;

function configuration(item: string, mode = 'on_error', providers = registry): string {
  return `swarm:\n${providers}
  chains:
    fallback:
      name: Fallback
      mode: ${mode}
      runtimes:
        - ${item}
`;
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
  throw new Error('expected field errors');
}

describe('chain model roles', () => {
  it.each(['on_error', 'random', 'round_robin', 'by_provider'])(
    'resolves a role to concrete values in %s without retaining the source reference',
    (mode) => {
      const config = parseConfig(
        configuration('{ model_role: code, provider: gateway, runtime: opencode }', mode),
      );
      expect(config.chains[0]?.runtimes).toEqual([
        {
          runtime: 'opencode',
          provider: 'gateway',
          model: 'proxy/base',
          enabled: true,
          variant: 'inherited',
          reasoningEffort: 'high',
        },
      ]);
    },
  );

  it.each([
    ['{ runtime: opencode, provider: gateway, model_role: "" }', 'model_role', 'must not be empty'],
    ['{ runtime: opencode, model_role: code }', 'provider', 'is required for model_role'],
    [
      '{ runtime: opencode, provider: gateway, model_role: missing }',
      'model_role',
      'unknown role `missing`',
    ],
    [
      '{ runtime: opencode, provider: gateway, model_role: empty }',
      'model_role',
      'no model for role `empty` at provider `gateway`',
    ],
    [
      '{ runtime: opencode, provider: missing, model_role: code }',
      'provider',
      'unknown provider `missing`; known: gateway (Gateway)',
    ],
    [
      '{ runtime: opencode, provider: gateway, model: proxy/fixed, model_role: code }',
      'model',
      'cannot be combined with model_role',
    ],
    [
      '{ runtime: opencode, provider: gateway, model_role: Bad_role }',
      'model_role',
      'slug must match ^[a-z][a-z0-9-]{0,31}$',
    ],
    ['{ runtime: opencode, provider: gateway, model_role: 42 }', 'model_role', 'must be a string'],
  ])('reports the exact field error for %s', (item, field, message) => {
    expect(errorsOf(configuration(item))).toEqual([
      {
        path: `swarm.chains.fallback.runtimes[0].${field}`,
        message,
      },
    ]);
  });

  it('validates role references in disabled chains and items', () => {
    expect(
      errorsOf(
        configuration(
          '{ runtime: opencode, provider: gateway, model_role: missing, enabled: false }',
        ).replace('name: Fallback', 'name: Fallback\n      enabled: false'),
      ),
    ).toEqual([
      {
        path: 'swarm.chains.fallback.runtimes[0].model_role',
        message: 'unknown role `missing`',
      },
    ]);
  });

  it('chooses the first enabled CLI route for the requested runtime and replaces whole role records', () => {
    const providers = `
  roles:
    code: { name: Code }
  providers:
    gateway:
      name: Gateway
      models:
        code: { model: base, variant: inherited, reasoning_effort: high }
      access:
        - { kind: api, models: { code: api-model } }
        - { kind: cli, runtime: claude, models: { code: claude-model } }
        - { kind: cli, runtime: opencode, enabled: false, model_prefix: disabled, models: { code: disabled-model } }
        - { kind: cli, runtime: opencode, model_prefix: proxy/nested, models: { code: route-model } }
        - { kind: cli, runtime: opencode, model_prefix: later, models: { code: later-model } }
`;
    expect(
      parseConfig(
        configuration(
          '{ runtime: opencode, provider: gateway, model_role: code }',
          'on_error',
          providers,
        ),
      ).chains[0]?.runtimes,
    ).toEqual([
      {
        runtime: 'opencode',
        provider: 'gateway',
        model: 'proxy/nested/route-model',
        enabled: true,
      },
    ]);
  });

  it('does not skip the first matching route when its role has no model', () => {
    const providers = registry
      .replace('code: { model: base, variant: inherited, reasoning_effort: high }', 'empty: unused')
      .replace(
        '- { kind: cli, runtime: claude }',
        '- { kind: cli, runtime: opencode, model_prefix: later, models: { code: later-model } }',
      );
    expect(
      errorsOf(
        configuration(
          '{ runtime: opencode, provider: gateway, model_role: code }',
          'on_error',
          providers,
        ),
      ),
    ).toEqual([
      {
        path: 'swarm.chains.fallback.runtimes[0].model_role',
        message: 'no model for role `code` at provider `gateway`',
      },
    ]);
  });

  it('inherits options only from the selected route record before applying explicit options', () => {
    const providers = registry.replace(
      'runtime: opencode, model_prefix: proxy',
      'runtime: opencode, model_prefix: proxy, models: { code: { model: route, reasoning_effort: low } }',
    );
    for (const [option, effort] of [
      ['', 'low'],
      [', reasoning_effort: high', 'high'],
    ]) {
      const item = parseConfig(
        configuration(
          `{ runtime: opencode, provider: gateway, model_role: code${option} }`,
          'on_error',
          providers,
        ),
      ).chains[0]?.runtimes[0];
      expect(item).toMatchObject({ model: 'proxy/route', reasoningEffort: effort });
      expect(item).not.toHaveProperty('variant');
    }
  });

  it('requires an enabled CLI route for the requested runtime', () => {
    const providers = registry.replace(
      'runtime: opencode, model_prefix: proxy',
      'runtime: opencode, enabled: false, model_prefix: proxy',
    );
    expect(
      errorsOf(
        configuration(
          '{ runtime: opencode, provider: gateway, model_role: code }',
          'on_error',
          providers,
        ),
      ),
    ).toEqual([
      {
        path: 'swarm.chains.fallback.runtimes[0].runtime',
        message: 'no enabled CLI route for opencode at provider `gateway`',
      },
    ]);
  });

  it('reports an unqualified resolved OpenCode model at the role field', () => {
    expect(
      errorsOf(
        configuration(
          '{ runtime: opencode, provider: gateway, model_role: code }',
          'on_error',
          registry.replace(', model_prefix: proxy', ''),
        ),
      ),
    ).toContainEqual({
      path: 'swarm.chains.fallback.runtimes[0].model_role',
      message:
        'OpenCode model "base" must use provider/model format, for example openai/gpt-6.1-sol',
    });
  });

  it.each([
    ['variant: explicit', 'explicit', 'high'],
    ['reasoning_effort: low', 'inherited', 'low'],
    ['variant: explicit, reasoning_effort: low', 'explicit', 'low'],
  ])('overrides inherited options independently: %s', (options, variant, reasoningEffort) => {
    const item = parseConfig(
      configuration(`{ ${options}, model_role: code, provider: gateway, runtime: opencode }`),
    ).chains[0]?.runtimes[0];
    expect(item).toMatchObject({ model: 'proxy/base', variant, reasoningEffort });
  });

  it.each(['claude', 'agy'])('does not copy OpenCode options to %s', (runtime) => {
    expect(
      parseConfig(configuration(`{ runtime: ${runtime}, provider: gateway, model_role: code }`))
        .chains[0]?.runtimes,
    ).toEqual([
      {
        runtime,
        provider: 'gateway',
        model: 'base',
        enabled: true,
      },
    ]);
  });

  it('still rejects explicit OpenCode options on other runtimes', () => {
    const errors = errorsOf(
      configuration(
        '{ runtime: claude, provider: gateway, model_role: code, variant: explicit, reasoning_effort: low }',
      ),
    );
    for (const field of ['variant', 'reasoning_effort']) {
      expect(errors).toContainEqual({
        path: `swarm.chains.fallback.runtimes[0].${field}`,
        message: 'is supported by the opencode runtime only',
      });
    }
  });

  it('keeps existing fixed model strings and omitted models unchanged', () => {
    for (const [source, model] of [
      ['model: other/fixed, ', 'other/fixed'],
      ['', null],
    ] as const) {
      expect(
        parseConfig(configuration(`{ ${source}runtime: opencode, provider: gateway }`)).chains[0]
          ?.runtimes,
      ).toEqual([
        {
          runtime: 'opencode',
          provider: 'gateway',
          model,
          enabled: true,
        },
      ]);
    }
  });

  it('resolves global and project files after whole-file overrides, without rewriting sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-chain-roles-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    const files = new Map<string, string>([
      [
        join(paths.global.directory, 'settings.yaml'),
        'roles:\n  code: { name: Code }\n  empty: { name: Empty }\n',
      ],
      [
        join(paths.global.directory, 'providers', 'gateway.yaml'),
        'name: Shared\naccess: [{ kind: cli, runtime: opencode, model_prefix: shared }, { kind: cli, runtime: claude }]\nmodels: { code: shared-model, empty: shared-only-model }\n',
      ],
      [
        join(paths.project.directory, 'providers', 'gateway.yaml'),
        'name: Project\naccess: [{ kind: cli, runtime: opencode, model_prefix: project }]\nmodels: { code: project-model }\n',
      ],
      [
        join(paths.global.directory, 'chains', 'fallback.yaml'),
        'name: Shared\nmode: on_error\nruntimes: [{ runtime: opencode, provider: gateway, model_role: code }, { runtime: claude, model: sonnet }]\n',
      ],
      [
        join(paths.project.directory, 'chains', 'fallback.yaml'),
        'name: Project\nmode: round_robin\nruntimes: [{ runtime: opencode, provider: gateway, model: shared/shared-model }]\n',
      ],
      [
        join(paths.global.directory, 'chains', 'shared.yaml'),
        'name: Shared only\nmode: random\nruntimes: [{ runtime: opencode, provider: gateway, model_role: code }]\n',
      ],
      [
        join(paths.project.directory, 'specialists', 'coder.yaml'),
        'name: Coder\nruntime_chain: fallback\n',
      ],
    ]);
    for (const [path, text] of files) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    const config = loadConfig(paths);
    expect(config.chains).toHaveLength(2);
    expect(config.chains.find((chain) => chain.slug === 'fallback')).toMatchObject({
      name: 'Project',
      mode: 'round_robin',
      level: 'project',
      runtimes: [
        { runtime: 'opencode', provider: 'gateway', model: 'shared/shared-model', enabled: true },
      ],
    });
    expect(config.chains.find((chain) => chain.slug === 'shared')?.runtimes[0]?.model).toBe(
      'project/project-model',
    );
    expect(config.providers[0]?.models).toEqual({ code: { model: 'project-model' } });
    expect(config.providers[0]?.access).toHaveLength(1);
    const global = loadGlobalConfigSources(paths).config;
    expect(global.chains.find((chain) => chain.slug === 'shared')?.level).toBe('global');
    expect(global.providers[0]?.level).toBe('global');
    expect(global.chains.find((chain) => chain.slug === 'shared')?.runtimes[0]?.model).toBe(
      'shared/shared-model',
    );
    for (const [path, text] of files) expect(readFileSync(path, 'utf8')).toBe(text);
  });
});
