import { describe, expect, it } from 'vitest';

import { roleModelOptions } from '../src/features/providers/index.ts';
import { accessState, providerView, roleView } from './providerFixtures.ts';

const roles = [roleView('think', 'Think'), roleView('code', 'Code'), roleView('light', 'Light')];

describe('roleModelOptions', () => {
  it('only resolves own role keys, including constructor', () => {
    const role = roleView('constructor', 'Constructor');
    const provider = providerView('proxy', {
      access: [{ ...accessState({ modelPrefix: 'proxy' }), models: {} }],
      models: { constructor: { model: 'A' } },
    });
    expect(roleModelOptions(provider, [role], 'claude')).toEqual([
      { role: 'constructor', name: 'Constructor', model: 'proxy/A' },
    ]);
    expect(roleModelOptions({ ...provider, models: {} }, [role], 'claude')).toEqual([]);
  });
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
    const provider = providerView('zai', { models: {} });
    expect(roleModelOptions(provider, roles, 'claude')).toEqual([]);
  });

  it('displays the exact model ID, including spaces retained by the loader', () => {
    const provider = providerView('example', {
      models: { think: { model: ' A ' } },
      access: [{ ...accessState({ runtime: 'claude' }), models: {} }],
    });
    expect(roleModelOptions(provider, roles, 'claude')).toEqual([
      { role: 'think', name: 'Think', model: ' A ' },
    ]);
  });

  it('uses the first enabled CLI of the exact runtime, regardless of availability', () => {
    const provider = providerView('proxy', {
      enabled: false,
      access: [
        { ...accessState({ enabled: false }), models: { think: { model: 'disabled' } } },
        { ...accessState({ kind: 'api' }), models: { think: { model: 'api' } } },
        { ...accessState({ runtime: 'opencode' }), models: { think: { model: 'other' } } },
        {
          ...accessState({ available: false, modelPrefix: 'proxy' }),
          models: { think: { model: 'A' } },
        },
        { ...accessState(), models: { think: { model: 'later' } } },
      ],
    });
    expect(roleModelOptions(provider, roles, 'claude')).toEqual([
      { role: 'think', name: 'Think', model: 'proxy/A' },
    ]);
  });

  it('does not try a later route when the first enabled route has an empty record', () => {
    const provider = providerView('proxy', {
      models: { think: { model: 'provider' } },
      access: [
        { ...accessState(), models: { think: { model: '' } } },
        { ...accessState(), models: { think: { model: 'later' } } },
      ],
    });
    expect(roleModelOptions(provider, roles, 'claude')).toEqual([]);
  });
});
