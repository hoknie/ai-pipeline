import { describe, expect, it } from 'vitest';
import {
  configFromFiles,
  validateObserverProfile,
} from '../../../src/feature/swarm-config/services/index.ts';

describe('agy configuration', () => {
  it('inherits agy, keeps its model, and uses it for naming and the observer', () => {
    const config = configFromFiles({
      settings: 'defaults: { runtime: agy }\nnaming: { runtime: agy, model: custom }',
      specialists: { coder: 'name: C\nmodel: custom' },
    });
    expect(config.specialists[0]).toMatchObject({ runtime: 'agy', model: 'custom' });
    expect(config.naming).toMatchObject({ runtime: 'agy', model: 'custom' });
    expect(config.runtimes.agy).toEqual({ command: 'agy', enabled: null, args: [], env: {} });
    expect(validateObserverProfile({ runtime: 'agy' }).errors).toEqual([]);
    expect(validateObserverProfile({ runtime: 'agy' }).specialist.runtime).toBe('agy');
  });

  it.each(['variant: high', 'reasoning_effort: high'])('rejects OpenCode-only %s', (field) => {
    expect(() =>
      configFromFiles({ specialists: { coder: `name: C\nruntime: agy\n${field}` } }),
    ).toThrow('is supported by the opencode runtime only');
  });

  it('keeps claude as the default for existing definitions', () => {
    expect(configFromFiles({ specialists: { coder: 'name: C' } }).specialists[0]?.runtime).toBe(
      'claude',
    );
  });
});
