import { describe, expect, it } from 'vitest';

import { roleModelOptions } from '../src/features/providers/index.ts';
import { accessState, providerView, roleView } from './providerFixtures.ts';

const roles = [roleView('think', 'Think'), roleView('code', 'Code'), roleView('light', 'Light')];

describe('roleModelOptions', () => {
  it('puts the prefix of the access before the model of the provider', () => {
    const provider = providerView('zai', {
      access: [
        { ...accessState({ runtime: 'opencode', modelPrefix: 'zai-coding-plan' }), models: {} },
      ],
      models: { think: { model: 'glm-5' } } as never,
    });
    expect(roleModelOptions(provider, roles, 'opencode')).toEqual([
      { role: 'think', name: 'Think', model: 'zai-coding-plan/glm-5' },
    ]);
  });

  it('takes the model of the access over the one of the provider', () => {
    const provider = providerView('zai', {
      access: [
        {
          ...accessState({ runtime: 'claude' }),
          models: { code: { model: 'opus' } } as never,
        },
      ],
      models: { code: { model: 'sonnet' }, think: { model: 'opus' } } as never,
    });
    expect(
      roleModelOptions(provider, roles, 'claude').map((item) => [item.role, item.model]),
    ).toEqual([
      ['think', 'opus'],
      ['code', 'opus'],
    ]);
  });

  it('gives nothing without an access for the runtime of the item', () => {
    const provider = providerView('zai', { models: { think: { model: 'glm' } } as never });
    expect(roleModelOptions(provider, roles, 'codex')).toEqual([]);
  });

  it('leaves out the roles without a model', () => {
    const provider = providerView('zai', { models: { think: { model: ' ' } } as never });
    expect(roleModelOptions(provider, roles, 'claude')).toEqual([]);
  });
});
