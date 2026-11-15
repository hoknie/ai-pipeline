import { describe, expect, it } from 'vitest';

import { transition } from '../../../src/feature/runs/machine/index.ts';
import {
  type RunState,
  describeFailReason,
  stepsOf,
} from '../../../src/feature/runs/types/index.ts';
import { applyVariant, findPipeline } from '../../../src/feature/swarm-config/types/index.ts';

import { config, group, run, step } from './helpers.ts';

const TEXT = `swarm:
  max: 5
  chains:
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { runtime: opencode, model: openai/gpt-5 }
        - { runtime: claude, model: sonnet }
  specialists:
    plan: { name: Plan }
    coder: { name: Coder, runtime: claude, model: sonnet }
    deep: { name: Deep, runtime: claude, model: opus }
    reviewer: { name: Reviewer, permissions: read }
    qa: { name: QA }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: qa, specialist: qa }
      variants:
        light:
          skip: [review]
        strong:
          steps:
            code: { model: opus, additional_prompt: "Be thorough" }
        resilient:
          steps:
            code: { runtime_chain: fallback }
        deep:
          steps:
            code: { specialist: deep }
    explore:
      steps:
        - { id: look, specialist: plan }
        - { id: check, specialist: reviewer }
    epic:
      split: { specialist: coder, pipeline: explore }
      variants:
        strong: { split: { model: opus } }
`;

/** The event the daemon builds: the current configuration with the variant applied. */
function switchTo(state: RunState, variant: string, text = TEXT) {
  return transition(
    state,
    {
      kind: 'variant_set',
      variant,
      config: applyVariant(config(text), state.run.pipeline, variant),
    },
    3000,
  );
}

function codeStep(state: RunState) {
  return stepsOf(state.run, group(state)).find((candidate) => candidate.id === 'code')!;
}

/** A run that starts at the code step: the first attempt is running. */
function runningCode(variant = 'default'): RunState {
  const state = run(1, { configText: TEXT, variant, skip: ['plan'] });
  step(state);
  return state;
}

describe('switching the variant of a run', () => {
  it('writes the overrides of the new variant into the snapshot', () => {
    const state = runningCode();
    switchTo(state, 'strong');
    expect(state.run.variant).toBe('strong');
    expect(codeStep(state)).toMatchObject({
      specialist: 'coder',
      additionalPrompt: 'Be thorough',
      agent: { model: 'opus' },
    });
  });

  it('removes the overrides when the run goes back to default', () => {
    const state = run(1, { configText: TEXT, variant: 'strong', skip: ['plan'] });
    switchTo(state, 'default');
    expect(state.run.variant).toBe('default');
    expect(codeStep(state).agent).toBeUndefined();
    expect(codeStep(state).additionalPrompt).toBeNull();
  });

  it('keeps the steps, the skips and the passed steps', () => {
    const state = runningCode();
    const before = stepsOf(state.run, group(state)).map((candidate) => candidate.id);
    const skipped = [...state.run.skippedSteps];
    switchTo(state, 'light');
    expect(stepsOf(state.run, group(state)).map((candidate) => candidate.id)).toEqual(before);
    expect(state.run.skippedSteps).toEqual(skipped);
  });

  it('stops the running step whose executor changed and starts it again', () => {
    const state = runningCode();
    const first = group(state).attempts[0]!;
    first.sessionId = 'session-1';
    const effects = switchTo(state, 'strong');
    expect(effects).toEqual([
      { kind: 'stop_attempt', run: 'run000000001', group: 'gruppa-1', seq: first.seq },
    ]);
    expect(first).toMatchObject({
      status: 'cancelled',
      reason: { kind: 'variant', from: 'default', to: 'strong' },
    });
    expect(group(state)).toMatchObject({
      status: 'queued',
      pending: { stepIndex: first.stepIndex, resume: false },
    });
    step(state, 3500);
    const second = group(state).attempts[1]!;
    expect(second).toMatchObject({ stepId: 'code', model: 'opus', status: 'running' });
    expect(second.resumeSession).toBeNull();
  });

  it('keeps the feedback and the answer for the new attempt', () => {
    const state = runningCode();
    const first = group(state).attempts[0]!;
    first.input = { ...first.input, feedback: 'fix the tests', humanAnswer: 'use sqlite' };
    switchTo(state, 'strong');
    expect(group(state).pending).toMatchObject({
      feedback: 'fix the tests',
      humanAnswer: 'use sqlite',
      resume: false,
    });
  });

  it('restarts the step with another specialist', () => {
    const state = runningCode();
    switchTo(state, 'deep');
    step(state, 3500);
    expect(group(state).attempts[1]).toMatchObject({ specialist: 'deep', model: 'opus' });
  });

  it('starts the first attempt of the chain of the new variant with its first item', () => {
    const state = runningCode();
    switchTo(state, 'resilient');
    step(state, 3500);
    expect(group(state).attempts[1]).toMatchObject({ runtime: 'opencode', model: 'openai/gpt-5' });
  });

  it('leaves the running step alone when its definition did not change', () => {
    const state = run(1, { configText: TEXT });
    step(state);
    const running = group(state).attempts[0]!;
    expect(running.stepId).toBe('plan');
    const effects = switchTo(state, 'strong');
    expect(effects).toEqual([]);
    expect(running.status).toBe('running');
    expect(state.run.variant).toBe('strong');
  });

  it('does not apply the skips of the new variant', () => {
    const state = run(1, { configText: TEXT });
    switchTo(state, 'light');
    expect(stepsOf(state.run, group(state)).map((candidate) => candidate.id)).toContain('review');
    expect(state.run.skippedSteps).toEqual([]);
  });

  it('does not resume the session of a group that waits on a changed step', () => {
    const state = run(1, { configText: TEXT, skip: ['plan'] });
    const waiting = group(state);
    waiting.status = 'needs_human';
    waiting.question = 'Which database?';
    waiting.pending = { stepIndex: 0, feedback: null, humanAnswer: null, resume: true };
    expect(switchTo(state, 'strong')).toEqual([]);
    expect(waiting).toMatchObject({
      status: 'needs_human',
      question: 'Which database?',
      pending: { stepIndex: 0, resume: false },
    });
  });

  it('keeps the resumption of a group that waits on an unchanged step', () => {
    const state = run(1, { configText: TEXT });
    const waiting = group(state);
    waiting.status = 'needs_human';
    waiting.pending = { stepIndex: 0, feedback: null, humanAnswer: null, resume: true };
    switchTo(state, 'strong');
    expect(waiting.pending?.resume).toBe(true);
  });

  it('adds a specialist of the variant the snapshot did not have', () => {
    const state = runningCode();
    state.run.config.specialists = state.run.config.specialists.filter(
      (specialist) => specialist.slug !== 'deep',
    );
    switchTo(state, 'deep');
    expect(state.run.config.specialists.some((specialist) => specialist.slug === 'deep')).toBe(
      true,
    );
  });

  it('does nothing when the run already follows the variant', () => {
    const state = runningCode('strong');
    const before = JSON.stringify(state);
    expect(switchTo(state, 'strong')).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('switching the variant of a run with a split', () => {
  it('restarts the running split step and changes the split of the snapshot', () => {
    const state = run(1, { configText: TEXT, pipeline: 'epic', split: true });
    step(state);
    const splitGroup = state.split!;
    const running = splitGroup.attempts[0]!;
    const effects = switchTo(state, 'strong');
    expect(effects).toEqual([
      { kind: 'stop_attempt', run: 'run000000001', group: splitGroup.slug, seq: running.seq },
    ]);
    expect(running.reason).toEqual({ kind: 'variant', from: 'default', to: 'strong' });
    expect(findPipeline(state.run.config, 'epic')?.split?.agent).toEqual({ model: 'opus' });
    step(state, 3500);
    expect(splitGroup.attempts[1]).toMatchObject({ model: 'opus', status: 'running' });
  });
});

describe('a refused switch', () => {
  it('refuses a finished run', () => {
    const state = run(1, { configText: TEXT });
    state.run.finishedAt = 2000;
    expect(() => switchTo(state, 'strong')).toThrow('run run000000001 is finished');
    expect(state.run.variant).toBe('default');
  });

  it('allows a finished run with a failed group: it can be retried with another variant', () => {
    const state = run(1, { configText: TEXT, skip: ['plan'] });
    state.run.finishedAt = 2000;
    group(state).status = 'failed';
    group(state).pending = { stepIndex: 0, feedback: null, humanAnswer: null, resume: true };
    switchTo(state, 'strong');
    expect(state.run.variant).toBe('strong');
    expect(group(state).pending?.resume).toBe(false);
  });

  it('refuses a pipeline that lost a step of the run and changes nothing', () => {
    const state = runningCode();
    const before = JSON.stringify(state);
    const renamed = TEXT.replace('id: code,', 'id: build,')
      .replace('goto: code', 'goto: build')
      .replaceAll('            code: {', '            build: {');
    expect(() => switchTo(state, 'strong', renamed)).toThrow(
      'pipeline `feature` changed since the run started: step `code` is gone',
    );
    expect(JSON.stringify(state)).toBe(before);
  });

  it('refuses a pipeline that lost its split', () => {
    const state = run(1, { configText: TEXT, pipeline: 'epic', split: true });
    const without = config(TEXT);
    findPipeline(without, 'epic')!.split = null;
    const before = JSON.stringify(state);
    expect(() =>
      transition(state, { kind: 'variant_set', variant: 'strong', config: without }, 3000),
    ).toThrow('pipeline `epic` changed since the run started: the split is gone');
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('the reason of a variant change', () => {
  it('names both variants', () => {
    expect(describeFailReason({ kind: 'variant', from: 'default', to: 'strong' })).toBe(
      'variant changed: default → strong',
    );
  });
});
