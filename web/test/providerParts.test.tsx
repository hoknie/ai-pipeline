import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import { providerLabel } from '../src/features/providers/list/label.ts';
import { reasonText } from '../src/features/providers/list/reasons.ts';
import { matchProviders } from '../src/features/providers/picker/match.ts';

const t = ((key: string, values?: Record<string, string>) =>
  `${key}${values ? JSON.stringify(values) : ''}`) as unknown as TFunction;

describe('reasonText', () => {
  it('translates the five known patterns', () => {
    expect(reasonText('access disabled', t)).toBe('providers.reasons.accessDisabled');
    expect(reasonText('api access is not implemented', t)).toBe('providers.reasons.apiSoon');
    expect(reasonText('runtime codex is disabled', t)).toBe(
      'providers.reasons.runtimeDisabled{"runtime":"codex"}',
    );
    expect(reasonText('command claude not found', t)).toBe(
      'providers.reasons.commandNotFound{"command":"claude"}',
    );
    expect(reasonText('variable ZAI_API_KEY is not set', t)).toBe(
      'providers.reasons.variableNotSet{"name":"ZAI_API_KEY"}',
    );
  });

  it('keeps an unknown reason as it is', () => {
    expect(reasonText('something new', t)).toBe('something new');
  });
});

describe('providerLabel', () => {
  it('takes the name and falls back to the slug', () => {
    expect(providerLabel('zai', 'Z.ai')).toBe('Z.ai');
    expect(providerLabel('zai', null)).toBe('zai');
    expect(providerLabel('zai', '  ')).toBe('zai');
    expect(providerLabel('zai')).toBe('zai');
  });
});

describe('matchProviders', () => {
  const providers = [
    { slug: 'off', name: 'Gamma', enabled: false },
    { slug: 'zai', name: 'Z.ai', enabled: true },
    { slug: 'openai', name: 'OpenAI', enabled: true },
  ];

  it('searches the name and the slug in any case', () => {
    expect(matchProviders(providers, 'OPEN').map((p) => p.slug)).toEqual(['openai']);
    expect(matchProviders(providers, 'z.a').map((p) => p.slug)).toEqual(['zai']);
  });

  it('puts the disabled ones last', () => {
    expect(matchProviders(providers, '').map((p) => p.slug)).toEqual(['zai', 'openai', 'off']);
  });
});
