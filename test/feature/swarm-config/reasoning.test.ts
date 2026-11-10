import { describe, expect, it } from 'vitest';

import {
  configFromFiles,
  validateConfig,
  validateObserverProfile,
} from '../../../src/feature/swarm-config/services/index.ts';
import { ConfigLoadError, mergeConfigs } from '../../../src/feature/swarm-config/types/index.ts';

const configOf = (fields: string, settings?: string) =>
  configFromFiles({ settings, specialists: { coder: `name: C\n${fields}\n` } });

describe('OpenCode model options', () => {
  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])(
    'accepts reasoning effort %s without requiring a model',
    (effort) => {
      const coder = configOf(`runtime: opencode\nreasoning_effort: ${effort}`).specialists[0]!;
      expect(coder.reasoningEffort).toBe(effort);
      expect(coder.model).toBeNull();
      expect(coder).not.toHaveProperty('variant');
    },
  );

  it('keeps a custom variant independent of effort and trims its edges', () => {
    const coder = configOf(
      'runtime: opencode\nmodel: openai/gpt-6.1-sol\nvariant: " company-deep "',
    ).specialists[0]!;
    expect(coder.variant).toBe('company-deep');
    expect(coder).not.toHaveProperty('reasoningEffort');
  });

  it('accepts both fields with an inherited runtime', () => {
    expect(
      configOf(
        'variant: concise\nreasoning_effort: high\nmodel: openai/gpt-6.1-sol',
        'defaults: { runtime: opencode }',
      ).specialists[0],
    ).toMatchObject({ runtime: 'opencode', variant: 'concise', reasoningEffort: 'high' });
  });

  it.each([
    ['variant', '12'],
    ['variant', '[high]'],
    ['variant', 'null'],
    ['variant', '"  "'],
    ['reasoning_effort', '12'],
    ['reasoning_effort', '[high]'],
    ['reasoning_effort', 'null'],
    ['reasoning_effort', '""'],
    ['reasoning_effort', 'highest'],
  ])('rejects invalid %s: %s with its file and field', (field, value) => {
    try {
      configOf(`runtime: opencode\n${field}: ${value}`);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigLoadError);
      const detail = (error as ConfigLoadError).detail;
      expect(detail.kind).toBe('invalid');
      if (detail.kind === 'invalid')
        expect(detail.errors).toContainEqual(
          expect.objectContaining({
            file: 'specialists/coder.yaml',
            path: `swarm.specialists.coder.${field}`,
          }),
        );
    }
  });

  it.each([['runtime: opencode\nvariant: high'], ['variant: high\nruntime: opencode']])(
    'rejects a variant without a model, which OpenCode cannot take: %j',
    (fields) => {
      const result = validateConfig({
        swarm: {
          specialists: {
            coder: {
              name: 'C',
              ...Object.fromEntries(fields.split('\n').map((line) => line.split(': '))),
            },
          },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.errors).toContainEqual({
          path: 'swarm.specialists.coder.variant',
          message: 'needs a model: OpenCode takes a variant only as provider/model#variant',
        });
    },
  );

  it.each([
    { runtime: 'claude', variant: 'high', reasoning_effort: 'high' },
    { variant: 'high', reasoning_effort: 'high', runtime: 'claude' },
    { variant: 'high', reasoning_effort: 'high' },
  ])('checks the resolved runtime regardless of key order', (fields) => {
    const result = validateConfig({ swarm: { specialists: { coder: { name: 'C', ...fields } } } });
    expect(result.ok).toBe(false);
    if (!result.ok)
      for (const field of ['variant', 'reasoning_effort']) {
        expect(result.errors).toContainEqual({
          path: `swarm.specialists.coder.${field}`,
          message: 'is supported by the opencode runtime only',
        });
      }
  });
});

describe('OpenCode options compatibility', () => {
  it('does not assign implicit options to existing specialists or the observer', () => {
    const ordinary = configOf('').specialists[0]!;
    const observer = validateObserverProfile({});
    expect(observer.errors).toEqual([]);
    for (const item of [ordinary, observer.specialist]) {
      expect(item).not.toHaveProperty('variant');
      expect(item).not.toHaveProperty('reasoningEffort');
    }
  });

  it('accepts the same explicit options for the observer profile', () => {
    const result = validateObserverProfile({
      runtime: 'opencode',
      model: 'openai/gpt-6.1-sol',
      variant: 'deep',
      reasoning_effort: 'xhigh',
    });
    expect(result.errors).toEqual([]);
    expect(result.specialist).toMatchObject({ variant: 'deep', reasoningEffort: 'xhigh' });
  });

  it('rejects both keys in defaults', () => {
    const result = validateConfig({
      swarm: {
        defaults: { variant: 'high', reasoning_effort: 'high' },
        specialists: { coder: { name: 'C' } },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map((error) => error.path)).toEqual([
        'swarm.defaults.variant',
        'swarm.defaults.reasoning_effort',
      ]);
  });

  it('replaces the shared specialist options as part of the whole definition', () => {
    const merged = mergeConfigs(
      {
        swarm: {
          specialists: {
            coder: {
              name: 'C',
              runtime: 'opencode',
              model: 'openai/gpt-6.1-sol',
              variant: 'deep',
              reasoning_effort: 'high',
            },
          },
        },
      },
      { swarm: { specialists: { coder: { name: 'Own', runtime: 'opencode' } } } },
    );
    const result = validateConfig(merged);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.specialists[0]).not.toHaveProperty('variant');
      expect(result.config.specialists[0]).not.toHaveProperty('reasoningEffort');
    }
  });
});
