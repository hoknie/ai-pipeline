import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConfigLoadError,
  type ConfigPaths,
  type FieldError,
  knownProviders,
  tierDefaultIndex,
} from '../../../src/feature/swarm-config/types/index.ts';
import {
  configPaths,
  loadConfig,
  parseConfig,
} from '../../../src/feature/swarm-config/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-chains-'));
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
  throw new Error('expected field errors');
}

function expectError(errors: FieldError[], path: string, fragment: string): void {
  expect(errors).toContainEqual({ path, message: expect.stringContaining(fragment) });
}

describe('runtime chains', () => {
  it('reads chains from chains/<slug>.yaml on global and project levels and overrides global', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'chains', 'fallback.yaml'),
      'name: Shared chain\nmode: on_error\nruntimes:\n  - runtime: claude\n    model: sonnet\n',
    );
    write(
      join(paths.project.directory, 'chains', 'fallback.yaml'),
      'name: Project chain\nmode: round_robin\nruntimes:\n  - runtime: opencode\n    model: openai/gpt-5\n',
    );
    write(
      join(paths.project.directory, 'chains', 'extra.yaml'),
      'name: Additional\nmode: random\nruntimes:\n  - runtime: agy\n',
    );
    write(
      join(paths.project.directory, 'specialists', 'coder.yaml'),
      'name: Coder\nruntime_chain: fallback\n',
    );

    const config = loadConfig(paths);
    expect(config.chains).toHaveLength(2);

    const fallback = config.chains.find((c) => c.slug === 'fallback');
    expect(fallback).toEqual({
      slug: 'fallback',
      name: 'Project chain',
      mode: 'round_robin',
      enabled: true,
      level: 'project',
      runtimes: [{ runtime: 'opencode', model: 'openai/gpt-5', enabled: true }],
    });

    const extra = config.chains.find((c) => c.slug === 'extra');
    expect(extra).toEqual({
      slug: 'extra',
      name: 'Additional',
      mode: 'random',
      enabled: true,
      level: 'project',
      runtimes: [{ runtime: 'agy', model: null, enabled: true }],
    });

    const coder = config.specialists.find((s) => s.slug === 'coder');
    expect(coder?.runtimeChain).toBe('fallback');
  });

  it('rejects chains section in settings.yaml', () => {
    const paths = temporaryPaths();
    write(
      join(paths.project.directory, 'settings.yaml'),
      'chains:\n  bad:\n    name: Bad\n    mode: on_error\n    runtimes: [{ runtime: claude }]\n',
    );
    write(join(paths.project.directory, 'specialists', 'coder.yaml'), 'name: Coder\n');

    expect(() => loadConfig(paths)).toThrow(ConfigLoadError);
  });

  it('validates chain mode and runtimes array', () => {
    const errors = errorsOf(`
swarm:
  chains:
    bad-mode:
      name: Bad Mode
      mode: fastest
      runtimes: [{ runtime: claude }]
    empty-runtimes:
      name: Empty
      mode: on_error
      runtimes: []
    no-runtime:
      name: No Runtime
      mode: random
      runtimes: [{ model: sonnet }]
    bad-runtime-type:
      name: Bad Item
      mode: on_error
      runtimes:
        - runtime: unknown_runtime
    opencode-options-on-claude:
      name: Opencode on Claude
      mode: on_error
      runtimes:
        - runtime: claude
          reasoning_effort: high
`);

    expectError(
      errors,
      'swarm.chains.bad-mode.mode',
      'must be one of on_error, random, round_robin, by_provider',
    );
    expectError(errors, 'swarm.chains.empty-runtimes.runtimes', 'must not be empty');
    expectError(errors, 'swarm.chains.no-runtime.runtimes[0].runtime', 'is required');
    expectError(
      errors,
      'swarm.chains.bad-runtime-type.runtimes[0].runtime',
      'must be one of claude, opencode, agy',
    );
    expectError(
      errors,
      'swarm.chains.opencode-options-on-claude.runtimes[0].reasoning_effort',
      'is supported by the opencode runtime only',
    );
  });

  it('rejects unqualified OpenCode model IDs, including disabled chain items', () => {
    const errors = errorsOf(
      `\nswarm:\n  chains:\n    fallback:\n      name: Fallback\n      mode: on_error\n      enabled: false\n      runtimes:\n        - runtime: opencode\n          model: luna-6.1\n          enabled: false\n`,
    );
    expectError(errors, 'swarm.chains.fallback.runtimes[0].model', 'provider/model');
  });

  it('keeps qualified IDs distinct and permits an omitted model', () => {
    const config = parseConfig(
      `\nswarm:\n  chains:\n    fallback:\n      name: Fallback\n      mode: on_error\n      runtimes:\n        - runtime: opencode\n          model: openai/gpt-custom\n        - runtime: opencode\n          model: other/gpt-custom\n        - runtime: opencode\n`,
    );
    expect(config.chains[0]?.runtimes.map((item) => item.model)).toEqual([
      'openai/gpt-custom',
      'other/gpt-custom',
      null,
    ]);
  });

  it('validates specialist referencing a chain and mutual exclusions', () => {
    const errors = errorsOf(`
swarm:
  chains:
    main:
      name: Main
      mode: on_error
      runtimes:
        - runtime: opencode
  specialists:
    conflict-runtime:
      name: Conflict 1
      runtime_chain: main
      runtime: claude
    conflict-model:
      name: Conflict 2
      runtime_chain: main
      model: sonnet
    conflict-variant:
      name: Conflict 3
      runtime_chain: main
      variant: test
    conflict-reasoning:
      name: Conflict 4
      runtime_chain: main
      reasoning_effort: high
    unknown-chain:
      name: Unknown
      runtime_chain: missing
`);

    expectError(
      errors,
      'swarm.specialists.conflict-runtime.runtime',
      'cannot be combined with runtime_chain',
    );
    expectError(
      errors,
      'swarm.specialists.conflict-model.model',
      'cannot be combined with runtime_chain',
    );
    expectError(
      errors,
      'swarm.specialists.conflict-variant.variant',
      'cannot be combined with runtime_chain',
    );
    expectError(
      errors,
      'swarm.specialists.conflict-reasoning.reasoning_effort',
      'cannot be combined with runtime_chain',
    );
    expectError(errors, 'swarm.specialists.unknown-chain.runtime_chain', 'unknown chain `missing`');
  });

  it('allows mcp in a chain without a claude runtime', () => {
    const config = parseConfig(`
swarm:
  providers:
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
  chains:
    no-claude:
      name: With Claude
      mode: on_error
      runtimes:
        - runtime: opencode
        - runtime: agy
    lite:
      name: Lite
      mode: by_provider
      runtimes:
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
  specialists:
    worker:
      name: Worker
      runtime_chain: no-claude
      mcp:
        tools: { command: tools }
    coder:
      name: Coder
      runtime_chain: lite
      mcp:
        tools: { command: tools }
`);
    expect(config.specialists.map((s) => s.runtimeChain)).toEqual(['no-claude', 'lite']);
  });
});

/** The `providers:` lines of a configuration text: one provider per slug, name in capitals. */
const registry = (...slugs: string[]): string =>
  `  providers:\n${slugs
    .map(
      (slug) =>
        `    ${slug}: { name: ${slug.toUpperCase()}, access: [{ kind: cli, runtime: claude }] }\n`,
    )
    .join('')}`;

describe('by_provider chains (tiers)', () => {
  const known = ['anthropic', 'zai', 'openai', 'a', 'b', 'c', 'ok'];
  const tier = (items: string, mode = 'by_provider', slugs = known): string =>
    `\nswarm:\n${registry(...slugs)}  chains:\n    thinking:\n      name: Thinking\n      mode: ${mode}\n      runtimes:\n${items}`;

  it('accepts a tier and keeps provider and default of the items', () => {
    const config = parseConfig(
      tier(
        `        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3, default: true }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-sol }
`,
      ),
    );
    const chain = config.chains[0]!;
    expect(chain.mode).toBe('by_provider');
    expect(chain.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai', 'openai']);
    expect(chain.runtimes.map((item) => item.default)).toEqual([undefined, true, undefined]);
  });

  it('requires a unique provider in every item, disabled ones included', () => {
    const errors = errorsOf(
      tier(
        `        - { provider: zai, runtime: opencode }
        - { runtime: opencode }
        - { provider: zai, runtime: opencode, enabled: false }
`,
      ),
    );
    expectError(errors, 'swarm.chains.thinking.runtimes[1].provider', 'is required');
    expectError(errors, 'swarm.chains.thinking.runtimes[2].provider', 'duplicate provider `zai`');
  });

  it('allows one default item only', () => {
    const errors = errorsOf(
      tier(
        `        - { provider: a, runtime: opencode, default: true }
        - { provider: b, runtime: opencode }
        - { provider: c, runtime: opencode, default: true }
`,
      ),
    );
    expectError(errors, 'swarm.chains.thinking.runtimes[2].default', 'only one item');
    expect(errors.some((e) => e.path.endsWith('runtimes[0].default'))).toBe(false);
  });

  it('refuses a provider id the registry does not know and a default outside a tier', () => {
    const errors = errorsOf(
      tier(
        `        - { provider: Z.ai, runtime: opencode, default: true }
        - { provider: ok, runtime: opencode }
`,
        'on_error',
      ),
    );
    expectError(errors, 'swarm.chains.thinking.runtimes[0].provider', 'unknown provider `Z.ai`');
    expectError(
      errors,
      'swarm.chains.thinking.runtimes[0].default',
      'is supported by the by_provider mode only',
    );
  });

  it('accepts a provider on an item of an on_error chain', () => {
    const config = parseConfig(
      tier('        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }\n', 'on_error'),
    );
    expect(config.chains[0]?.runtimes[0]?.provider).toBe('zai');
  });

  it('names the registry in the error of a provider without an entity', () => {
    const errors = errorsOf(
      `
swarm:
  providers:
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
  chains:
    thinking:
      name: T
      mode: by_provider
      runtimes:
        - { provider: openai, runtime: opencode }
`,
    );
    expect(errors).toContainEqual({
      path: 'swarm.chains.thinking.runtimes[0].provider',
      message: 'unknown provider `openai`; known: anthropic (Anthropic), zai (Z.ai)',
    });
  });

  it('says none when no provider is defined', () => {
    const errors = errorsOf(
      tier('        - { provider: zai, runtime: opencode }\n', 'by_provider', []),
    );
    expect(errors).toContainEqual({
      path: 'swarm.chains.thinking.runtimes[0].provider',
      message: 'unknown provider `zai`; known: none',
    });
  });

  it('accepts the provider of an item although the provider is disabled', () => {
    const config = parseConfig(`
swarm:
  providers:
    zai: { name: Z.ai, enabled: false, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
  chains:
    thinking:
      name: T
      mode: by_provider
      runtimes:
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
`);
    expect(config.chains[0]?.runtimes[0]?.provider).toBe('zai');
  });

  it('lists the registry sorted by slug, whatever the chains say, and picks the default item', () => {
    const config = parseConfig(`
swarm:
${registry('zai', 'anthropic', 'openai', 'google', 'gemini', 'local', 'unused')}  chains:
    thinking:
      name: T
      mode: by_provider
      runtimes:
        - { provider: zai, runtime: opencode }
        - { provider: anthropic, runtime: claude }
        - { provider: openai, runtime: opencode, enabled: false }
    lite:
      name: L
      mode: by_provider
      runtimes:
        - { provider: zai, runtime: opencode, enabled: false }
        - { provider: google, runtime: opencode, default: true }
        - { provider: gemini, runtime: opencode }
    fallback:
      name: F
      mode: on_error
      runtimes:
        - { provider: local, runtime: opencode }
`);
    expect(knownProviders(config).map((provider) => provider.slug)).toEqual([
      'anthropic',
      'gemini',
      'google',
      'local',
      'openai',
      'unused',
      'zai',
    ]);
    const by = (slug: string) => config.chains.find((c) => c.slug === slug)!;
    expect(tierDefaultIndex(by('thinking'))).toBe(0);
    expect(tierDefaultIndex(by('lite'))).toBe(1);
    expect(
      tierDefaultIndex({ runtimes: [{ runtime: 'claude', model: null, enabled: false }] }),
    ).toBeNull();
  });

  it('does not treat a disabled default item as the default', () => {
    const config = parseConfig(
      tier(
        `        - { provider: a, runtime: opencode }
        - { provider: b, runtime: opencode, default: true, enabled: false }
`,
      ),
    );
    expect(tierDefaultIndex(config.chains[0]!)).toBe(0);
  });
});
