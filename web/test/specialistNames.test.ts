import { describe, expect, it } from 'vitest';

import { draftOf } from '../src/features/pipelines/form/steps/draft.ts';
import { draftGraph } from '../src/features/pipelines/form/steps/draftGraph.ts';
import {
  nameOf,
  specialistName,
  specialistNames,
  specialistOption,
} from '../src/shared/lib/catalog/specialists.ts';
import { stepIds } from '../src/features/pipelines/stepIds.ts';
import { specialistEntry } from './fixtures.ts';

describe('names of the specialists', () => {
  it('takes the validated name, then the one of the file, then the slug', () => {
    expect(specialistName(specialistEntry('reviewer', {}, { name: 'Inspector' }))).toBe(
      'Inspector',
    );
    const invalid = specialistEntry('coder', { effective: null, raw: { name: '  Coder ' } });
    expect(specialistName(invalid)).toBe('Coder');
    expect(specialistName(specialistEntry('plan', { effective: null, raw: { name: ' ' } }))).toBe(
      'plan',
    );
    expect(specialistName(specialistEntry('x', { effective: null, raw: {} }))).toBe('x');
  });

  it('shows «Name (slug)» in a choice and the bare slug when there is no other name', () => {
    const names = specialistNames([
      specialistEntry('reviewer', {}, { name: 'Inspector' }),
      specialistEntry('same', {}, { name: 'same' }),
    ]);
    expect(nameOf(names, 'reviewer')).toBe('Inspector');
    expect(nameOf(names, 'ghost')).toBe('ghost');
    expect(specialistOption(names, 'reviewer')).toBe('Inspector (reviewer)');
    expect(specialistOption(names, 'same')).toBe('same');
    expect(specialistOption(names, 'ghost')).toBe('ghost');
  });

  it('puts the name on the canvas nodes and the slug in the hint', () => {
    const draft = draftOf({
      split: { specialist: 'reviewer' },
      steps: [{ id: 'review', specialist: 'reviewer' }],
    });
    const graph = draftGraph(draft, {
      pipelineId: 'feature',
      ids: stepIds(draft.steps),
      follow: null,
      points: { before_split: [], after_split: [], before_delivery: [], after_delivery: [] },
      stages: null,
      errors: [],
      editable: true,
      specialistName: (slug) => (slug === 'reviewer' ? 'Inspector' : slug),
    });
    const step = graph.nodes.find((node) => node.data.kind === 'step')!.data;
    expect(step.title).toBe('review');
    expect(step.subtitle).toBe('Inspector');
    expect(step.subtitleHint).toBe('reviewer');
    const split = graph.nodes.find((node) => node.data.kind === 'split')!.data;
    expect(split.subtitle).toBe('Inspector');
    expect(split.subtitleHint).toBe('reviewer');
  });

  it('puts the names on the steps of the pipeline the groups follow', () => {
    const draft = draftOf({ split: { specialist: 'plan', pipeline: 'base' } });
    const graph = draftGraph(draft, {
      pipelineId: 'feature',
      ids: [],
      follow: {
        pipeline: 'base',
        steps: [{ id: 'review', specialist: 'reviewer', gotoIndex: null, maxRounds: '' }],
      },
      points: { before_split: [], after_split: [], before_delivery: [], after_delivery: [] },
      stages: null,
      errors: [],
      editable: false,
      specialistName: () => 'Inspector',
    });
    const follow = graph.nodes.find((node) => node.data.kind === 'follow')!.data;
    expect(follow.subtitle).toBe('Inspector');
    expect(follow.subtitleHint).toBe('reviewer');
    const split = graph.nodes.find((node) => node.data.kind === 'split')!.data;
    expect(split.title).toBe('base');
    expect(split.subtitleHint).toBeUndefined();
  });
});
