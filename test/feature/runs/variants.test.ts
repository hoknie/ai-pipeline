import { describe, expect, it } from 'vitest';

import { dispatch, transition } from '../../../src/feature/runs/machine/index.ts';
import { stepsOf, topology, type RunState } from '../../../src/feature/runs/types/index.ts';
import { findPipeline } from '../../../src/feature/swarm-config/types/index.ts';

import { group, run } from './helpers.ts';

const TEXT = `swarm:
  max: 5
  chains:
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { runtime: claude, model: sonnet }
        - { runtime: opencode, model: openai/gpt-5 }
  specialists:
    plan: { name: Plan }
    coder: { name: Coder, runtime: claude, model: sonnet }
    reviewer: { name: Reviewer, permissions: read }
    qa: { name: QA }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: qa, specialist: qa, on_reject: { goto: code, max_rounds: 3 } }
      variants:
        light:
          skip: [review]
        strong:
          steps:
            code: { model: opus }
        resilient:
          steps:
            code: { runtime_chain: fallback }
    explore:
      steps:
        - { id: look, specialist: plan }
        - { id: check, specialist: reviewer }
      variants:
        light: { skip: [check] }
    epic:
      split: { specialist: coder, pipeline: explore }
      variants:
        light: { split: { model: haiku } }
        strong: { split: { model: opus } }
`;

function started(variant: string, options: { pipeline?: string; skip?: string[] } = {}) {
  return run(1, { configText: TEXT, variant, ...options });
}

function stepIds(state: RunState): string[] {
  return stepsOf(state.run, group(state)).map((step) => step.id);
}

describe('a run with a variant', () => {
  it('keeps default as the pipeline as it is', () => {
    const state = run(1, { configText: TEXT });
    expect(state.run.variant).toBe('default');
    expect(stepIds(state)).toEqual(['plan', 'code', 'review', 'qa']);
  });

  it('starts the code step with the stronger model', () => {
    const state = started('strong');
    expect(state.run.variant).toBe('strong');
    dispatch([state], 1000);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: { sessionId: null, usage: null, failure: null, outsideChanges: [] },
      },
      1500,
    );
    // the first step is the plan: the model of the code step shows in the topology
    expect(topology(state).steps.find((step) => step.id === 'code')).toMatchObject({
      specialist: 'coder',
      runtime: 'claude',
      model: 'opus',
    });
    expect(topology(state).steps.find((step) => step.id === 'plan')?.model).toBeNull();
  });

  it('runs the attempt of the code step with opus', () => {
    const state = started('strong', { skip: ['plan', 'qa', 'review'] });
    dispatch([state], 1000);
    const attempt = group(state).attempts[0]!;
    expect(attempt.stepId).toBe('code');
    expect(attempt.model).toBe('opus');
    expect(attempt.runtime).toBe('claude');
  });

  it('leaves out the steps of the variant', () => {
    expect(stepIds(started('light'))).toEqual(['plan', 'code', 'qa']);
  });

  it('adds the skip of the task to the skip of the variant', () => {
    expect(stepIds(started('light', { skip: ['qa'] }))).toEqual(['plan', 'code']);
  });

  it('refuses a skip of the task that leaves no steps together with the variant', () => {
    expect(() => started('light', { skip: ['plan', 'code', 'qa'] })).toThrow(
      /skip leaves no steps/,
    );
  });

  it('refuses an unknown variant naming the known ones', () => {
    expect(() => started('fast')).toThrow(
      'unknown variant `fast` of pipeline `feature`; known: default, light, strong, resilient',
    );
  });

  it('is not changed by a later edit of the variants', () => {
    const state = started('strong');
    const source = findPipeline(state.run.config, 'feature')!;
    expect(source.steps[1]?.agent).toEqual({ model: 'opus' });
    expect(source.variants?.map((variant) => variant.id)).toEqual(['light', 'strong', 'resilient']);
  });
});

describe('a variant of a pipeline with split.pipeline', () => {
  it('changes the split step of the epic and the steps of the target of the same name', () => {
    const state = started('light', { pipeline: 'epic' });
    expect(findPipeline(state.run.config, 'epic')?.split?.agent).toEqual({ model: 'haiku' });
    expect(stepIds(state)).toEqual(['look']);
  });

  it('leaves the target as it is when it has no such variant', () => {
    const state = started('strong', { pipeline: 'epic' });
    expect(findPipeline(state.run.config, 'epic')?.split?.agent).toEqual({ model: 'opus' });
    expect(stepIds(state)).toEqual(['look', 'check']);
  });
});

describe('a variant with a chain', () => {
  it('switches to the next item of the chain of the variant after a failure', () => {
    const state = started('resilient', { skip: ['plan', 'review', 'qa'] });
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({ runtime: 'claude', model: 'sonnet' });
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: {
          sessionId: null,
          usage: null,
          failure: { kind: 'runtime_not_found', runtime: 'claude' },
          outsideChanges: [],
        },
      },
      2000,
    );
    expect(group(state).status).toBe('queued');
    dispatch([state], 2100);
    expect(group(state).attempts[1]).toMatchObject({ runtime: 'opencode', model: 'openai/gpt-5' });
  });
});
