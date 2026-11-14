import { describe, expect, it } from 'vitest';

import { draftOf, valueOf } from '../src/features/pipelines/form/steps/draft.ts';
import { withSplit } from '../src/features/pipelines/form/steps/draftOps.ts';
import {
  freeVariantId,
  newVariant,
  patchOverride,
} from '../src/features/pipelines/form/variants/variantDraft.ts';

const RAW = {
  steps: [
    { id: 'plan', specialist: 'plan' },
    { id: 'code', specialist: 'coder' },
    { id: 'review', specialist: 'reviewer' },
  ],
  variants: {
    light: { name: 'Light', skip: ['review'] },
    strong: { steps: { code: { model: 'opus' } } },
    quiet: { steps: { review: { additional_prompt: null } } },
  },
};

describe('variants of a draft', () => {
  it('writes the variants of the file back as they are', () => {
    expect(valueOf(draftOf(RAW))).toEqual(RAW);
  });

  it('writes only the fields that were set', () => {
    const draft = draftOf({ ...RAW, variants: { strong: {} } });
    const variant = draft.variants[0]!;
    const key = draft.steps[1]!.key;
    variant.steps.set(key, patchOverride({}, { model: 'opus' }));
    expect(valueOf(draft).variants).toEqual({ strong: { steps: { code: { model: 'opus' } } } });
    variant.steps.set(key, patchOverride(variant.steps.get(key)!, { model: undefined }));
    expect(valueOf(draft).variants).toEqual({ strong: {} });
  });

  it('keeps the three states of the additional prompt', () => {
    const draft = draftOf({
      ...RAW,
      variants: {
        v: { steps: { plan: { additional_prompt: 'x' }, code: { additional_prompt: null } } },
      },
    });
    const steps = draft.variants[0]!.steps;
    expect(steps.get(draft.steps[0]!.key)?.additionalPrompt).toBe('x');
    expect(steps.get(draft.steps[1]!.key)?.additionalPrompt).toBeNull();
    expect(steps.get(draft.steps[2]!.key)).toBeUndefined();
  });

  it('clears the model when a chain is chosen and the chain when a model is chosen', () => {
    const withModel = patchOverride({}, { runtime: 'claude', model: 'opus' });
    expect(patchOverride(withModel, { runtimeChain: 'fallback' })).toEqual({
      runtimeChain: 'fallback',
    });
    expect(patchOverride({ runtimeChain: 'fallback' }, { model: 'opus' })).toEqual({
      model: 'opus',
    });
  });

  it('keeps unknown keys and ids without a step', () => {
    const raw = {
      steps: [{ id: 'plan', specialist: 'plan' }],
      variants: { odd: { color: 'red', skip: ['gone'], steps: { gone: { model: 'x' } } } },
    };
    expect(valueOf(draftOf(raw))).toEqual(raw);
  });

  it('finds a free id', () => {
    const draft = draftOf({ ...RAW, variants: { variant: {}, 'variant-2': {} } });
    expect(freeVariantId(draft.variants)).toBe('variant-3');
    expect(newVariant([]).id).toBe('variant');
  });

  it('leaves out steps and skip while the groups follow another pipeline, and brings them back', () => {
    const draft = draftOf({
      ...RAW,
      variants: { light: { name: 'Light', skip: ['review'], steps: { code: { model: 'opus' } } } },
    });
    const split = withSplit(draft, { specialist: 'coder', pipeline: 'task' });
    expect(valueOf(split).variants).toEqual({ light: { name: 'Light' } });
    const back = withSplit(split, { pipeline: '' });
    expect(valueOf(back).variants).toEqual({
      light: { name: 'Light', skip: ['review'], steps: { code: { model: 'opus' } } },
    });
  });

  it('writes the split override of a variant', () => {
    const draft = draftOf({
      split: { specialist: 'coder', pipeline: 'task' },
      variants: { light: { split: { model: 'haiku' } } },
    });
    expect(valueOf(draft).variants).toEqual({ light: { split: { model: 'haiku' } } });
  });
});
