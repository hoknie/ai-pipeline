import { emptyAccess, emptyDraft, type AccessDraft, type ProviderDraft } from './draft.ts';

export const PRESET_IDS = ['anthropic', 'zai', 'openai', 'gemini', 'custom'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** The names of the presets that are not translated; `custom` is named in the locales. */
export const PRESET_NAMES: Record<Exclude<PresetId, 'custom'>, string> = {
  anthropic: 'Anthropic',
  zai: 'Z.ai GLM Coding Plan',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

const ANTHROPIC_MODELS: Record<string, string> = { think: 'opus', code: 'sonnet', light: 'haiku' };

function access(overrides: Partial<AccessDraft>): AccessDraft {
  return { ...emptyAccess(), ...overrides };
}

/**
 * The form of a preset: name, slug and accesses. Only Anthropic gets models, and only for the roles
 * the configuration has (`roles` are their slugs). Everything stays editable.
 */
export function presetDraft(id: PresetId, roles: readonly string[]): ProviderDraft {
  const base = { ...emptyDraft(), slugTouched: true };
  if (id === 'anthropic') {
    const models = Object.fromEntries(
      Object.entries(ANTHROPIC_MODELS)
        .filter(([role]) => roles.includes(role))
        .map(([role, model]) => [role, { model, variant: '', effort: '' }]),
    );
    return {
      ...base,
      name: PRESET_NAMES.anthropic,
      slug: 'anthropic',
      access: [access({ runtime: 'claude' })],
      models,
    };
  }
  if (id === 'zai') {
    return {
      ...base,
      name: PRESET_NAMES.zai,
      slug: 'zai',
      access: [
        access({
          runtime: 'claude',
          baseUrl: 'https://api.z.ai/api/anthropic',
          keyEnv: 'ZAI_API_KEY',
        }),
        access({ runtime: 'opencode', modelPrefix: 'zai-coding-plan' }),
      ],
    };
  }
  if (id === 'openai') {
    return {
      ...base,
      name: PRESET_NAMES.openai,
      slug: 'openai',
      access: [access({ runtime: 'codex' })],
    };
  }
  if (id === 'gemini') {
    return {
      ...base,
      name: PRESET_NAMES.gemini,
      slug: 'gemini',
      access: [access({ runtime: 'opencode', modelPrefix: 'google' })],
    };
  }
  return {
    ...emptyDraft(),
    access: [access({ runtime: 'codex', endpointRequired: true })],
  };
}
