import { describe, expect, it } from 'vitest';

import { OBSERVER_SPECIALIST } from '../../../src/feature/swarm-config/types/index.ts';
import {
  parseConfig,
  validateObserverProfile,
} from '../../../src/feature/swarm-config/services/index.ts';

describe('observer profile', () => {
  it('parses a profile into the specialist _observer without queue and limit', () => {
    const { specialist, errors } = validateObserverProfile({
      name: 'Watcher',
      runtime: 'opencode',
      timeout: '20m',
      permissions: 'edit',
    });
    expect(errors).toEqual([]);
    expect(specialist).toMatchObject({
      slug: OBSERVER_SPECIALIST,
      name: 'Watcher',
      runtime: 'opencode',
      timeoutSeconds: 1200,
      permissions: 'edit',
      queue: false,
      max: null,
    });
    expect(OBSERVER_SPECIALIST).toBe('_observer');
  });

  it('accepts an empty profile and names it Observer', () => {
    const { specialist, errors } = validateObserverProfile({});
    expect(errors).toEqual([]);
    expect(specialist.name).toBe('Observer');
  });

  it('reports a bad timeout with the field path', () => {
    const { errors } = validateObserverProfile({ name: 'W', timeout: 'soon' });
    expect(errors).toEqual([
      { path: 'specialist.timeout', message: 'must be a positive duration such as 90s, 30m or 2h' },
    ]);
  });

  it('rejects max, queue and tags and unknown keys', () => {
    const { errors } = validateObserverProfile({ max: 2, queue: true, tags: ['a'], nope: 1 });
    expect(errors.map((error) => error.path).sort()).toEqual([
      'specialist.max',
      'specialist.nope',
      'specialist.queue',
      'specialist.tags',
    ]);
  });

  it('rejects a profile that is not a mapping', () => {
    expect(validateObserverProfile('x').errors).toEqual([
      { path: 'specialist', message: 'must be a mapping' },
    ]);
  });

  it('is not a key of swarm.yaml', () => {
    expect(() => parseConfig('swarm:\n  observers:\n    enabled: true\n')).toThrow(/observers/);
  });
});
