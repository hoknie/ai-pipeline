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
      'name: Общая цепочка\nmode: on_error\nruntimes:\n  - runtime: claude\n    model: sonnet\n',
    );
    write(
      join(paths.project.directory, 'chains', 'fallback.yaml'),
      'name: Проектная цепочка\nmode: round_robin\nruntimes:\n  - runtime: opencode\n    model: openai/gpt-5\n',
    );
    write(
      join(paths.project.directory, 'chains', 'extra.yaml'),
      'name: Дополнительная\nmode: random\nruntimes:\n  - runtime: agy\n',
    );
    write(
      join(paths.project.directory, 'specialists', 'coder.yaml'),
      'name: Кодировщик\nruntime_chain: fallback\n',
    );

    const config = loadConfig(paths);
    expect(config.chains).toHaveLength(2);

    const fallback = config.chains.find((c) => c.slug === 'fallback');
    expect(fallback).toEqual({
      slug: 'fallback',
      name: 'Проектная цепочка',
      mode: 'round_robin',
      enabled: true,
      level: 'project',
      runtimes: [{ runtime: 'opencode', model: 'openai/gpt-5', enabled: true }],
    });

    const extra = config.chains.find((c) => c.slug === 'extra');
    expect(extra).toEqual({
      slug: 'extra',
      name: 'Дополнительная',
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
      'must be one of on_error, random, round_robin',
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
    mcp-without-claude:
      name: MCP Without Claude
      runtime_chain: main
      mcp:
        tools: { command: tools }
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
    expectError(
      errors,
      'swarm.specialists.mcp-without-claude.mcp',
      'requires at least one claude runtime in chain `main`',
    );
  });

  it('allows mcp when chain has at least one claude runtime', () => {
    const config = parseConfig(`
swarm:
  chains:
    with-claude:
      name: With Claude
      mode: on_error
      runtimes:
        - runtime: opencode
        - runtime: claude
  specialists:
    worker:
      name: Worker
      runtime_chain: with-claude
      mcp:
        tools: { command: tools }
`);
    expect(config.specialists[0]?.runtimeChain).toBe('with-claude');
  });
});
