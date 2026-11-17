import { describe, expect, it } from 'vitest';

import { accessFields, hasOpencode } from '../src/features/providers/form/accessFields.ts';
import {
  draftOf,
  emptyDraft,
  formErrors,
  stepOfPath,
  valueOf,
} from '../src/features/providers/form/draft.ts';
import { presetDraft } from '../src/features/providers/form/presets.ts';
import { SLUG_PATTERN, slugOf } from '../src/features/providers/form/slug.ts';

describe('slugOf', () => {
  it('makes a slug from a name', () => {
    expect(slugOf('Z.ai GLM')).toBe('zai-glm');
  });

  it('transliterates Cyrillic', () => {
    expect(slugOf('Мой провайдер')).toBe('moy-provayder');
  });

  it('cuts to 32 characters and starts with a letter', () => {
    const slug = slugOf('1 ' + 'a'.repeat(50));
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
});

describe('accessFields', () => {
  it('shows the fields of the runtime and the level', () => {
    expect(accessFields('opencode', 'global')).toEqual({
      modelPrefix: true,
      endpoint: false,
      command: true,
    });
    expect(accessFields('codex', 'project')).toEqual({
      modelPrefix: false,
      endpoint: true,
      command: false,
    });
  });

  it('knows an access through opencode', () => {
    expect(hasOpencode([{ kind: 'cli', runtime: 'opencode' }])).toBe(true);
    expect(hasOpencode([{ kind: 'cli', runtime: 'claude' }])).toBe(false);
  });
});

describe('draft', () => {
  it('sends a path of the daemon to the step of the field', () => {
    expect(stepOfPath('swarm.providers.zai.access[0].model_prefix')).toBe('access');
    expect(stepOfPath('swarm.providers.zai.name')).toBe('name');
    expect(stepOfPath('swarm.providers.zai.models.think')).toBe('models');
  });

  it('round-trips a provider file and keeps only the names of variables', () => {
    const raw = {
      name: 'Z.ai',
      access: [
        {
          kind: 'cli',
          runtime: 'claude',
          endpoint: { base_url: 'https://api.z.ai/api/anthropic', key_env: 'ZAI_API_KEY' },
        },
      ],
      models: { code: 'glm-5' },
    };
    expect(valueOf(draftOf('zai', raw, 'global'))).toEqual(raw);
  });

  it('refuses a key that is not a variable name and a taken slug', () => {
    const draft = presetDraft('zai', []);
    draft.access[0]!.keyEnv = 'sk-abc def';
    expect(formErrors(draft, 'access', new Set(), true)['access.0.endpoint.key_env']).toBe(
      'keyNotName',
    );
    expect(formErrors(draft, 'name', new Set(['zai']), true).slug).toBe('slugTaken');
    expect(formErrors(emptyDraft(), 'name', new Set(), true).name).toBe('required');
  });
});

describe('presets', () => {
  it('gives Anthropic models only for the roles that exist', () => {
    expect(presetDraft('anthropic', []).models).toEqual({});
    const models = presetDraft('anthropic', ['code']).models;
    expect(Object.keys(models)).toEqual(['code']);
    expect(models.code?.model).toBe('sonnet');
  });

  it('fills Z.ai with two accesses and names of variables', () => {
    const draft = presetDraft('zai', []);
    expect(draft.slug).toBe('zai');
    expect(draft.access.map((a) => a.runtime)).toEqual(['claude', 'opencode']);
    expect(draft.access[0]?.keyEnv).toBe('ZAI_API_KEY');
  });
});
