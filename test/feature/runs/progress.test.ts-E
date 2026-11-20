import { describe, expect, it } from 'vitest';

import { findGroup } from '../../../src/feature/runs/types/index.ts';
import { stepProgress } from '../../../src/feature/runs/services/index.ts';

import { CONFIG_TEXT, finish, run, runningAttempt as runningAttemptOf, step } from './helpers.ts';

describe('stepProgress', () => {
  it('counts every step of merged, merging and conflict groups', () => {
    const state = run(3);
    findGroup(state, 'group-1')!.status = 'merged';
    findGroup(state, 'group-2')!.status = 'merging';
    findGroup(state, 'group-3')!.status = 'conflict';
    expect(stepProgress(state)).toEqual({ done: 12, total: 12, current: null });
  });

  it('counts a queued group without passes as 0 and its path from the pending step', () => {
    const state = run(2);
    findGroup(state, 'group-2')!.pending!.stepIndex = 2;
    expect(stepProgress(state)).toEqual({ done: 0, total: 6, current: null });
  });

  it('counts a running group by the step of its running attempt', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    expect(stepProgress(state)).toEqual({
      done: 1,
      total: 4,
      current: { step: 'code', name: 'Coder', number: 2 },
    });
  });

  it('counts failed, cancelled and needs_human groups by their passes', () => {
    for (const status of ['failed', 'cancelled', 'needs_human'] as const) {
      const state = run(1);
      step(state);
      finish(state, 'done');
      step(state);
      findGroup(state, 'group-1')!.status = status;
      expect(stepProgress(state).done).toBe(1);
    }
  });

  function sentBack(state: ReturnType<typeof run>, steps: number) {
    for (let index = 0; index < steps; index += 1) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    finish(state, 'rejected', { feedback: 'redo' });
  }

  it('lengthens the path when a group returns to an earlier step', () => {
    const state = run(1);
    sentBack(state, 2);
    expect(stepProgress(state)).toEqual({
      done: 3,
      total: 6,
      current: { step: 'code', name: 'Coder', number: 4 },
    });
  });

  it('counts a return to the first step as a pass', () => {
    const state = run(1, {
      configText: CONFIG_TEXT.replace('        - { id: plan, specialist: plan }\n', ''),
    });
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'rejected', { feedback: 'redo' });
    const progress = stepProgress(state);
    expect([progress.done, progress.total]).toEqual([2, 5]);
    expect(progress.current).toMatchObject({ step: 'code', number: 3 });
  });

  it('grows with every repeated pass', () => {
    const state = run(1);
    sentBack(state, 2);
    step(state);
    finish(state, 'done');
    expect(stepProgress(state)).toMatchObject({ done: 4, total: 6 });
    step(state);
    finish(state, 'done');
    expect(stepProgress(state)).toMatchObject({ done: 5, total: 6 });
  });

  it('counts failed and cancelled groups after a return by their passes', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const state = run(1);
      sentBack(state, 2);
      findGroup(state, 'group-1')!.status = status;
      expect(stepProgress(state).done).toBe(3);
    }
  });

  it('does not count a failed attempt or needs_human as a pass', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'needs_human', { questions: [{ text: 'what to do?' } as never] });
    expect(stepProgress(state).done).toBe(1);
    const failed = run(1);
    step(failed);
    runningAttemptOf(failed).status = 'failed';
    expect(stepProgress(failed).done).toBe(0);
  });

  it('gives the user example: code, review, qa, summary with a return from qa', () => {
    const configText = `swarm:
  max: 5
  specialists:
    coder: { name: Coder }
    reviewer: { name: Reviewer, permissions: read }
    qa: { name: Tester }
    sum: { name: Summarizer }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
        - { id: qa, specialist: qa, on_reject: { goto: code, max_rounds: 3 } }
        - { id: sum, specialist: sum }
`;
    const state = run(1, { configText });
    for (let index = 0; index < 2; index += 1) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    finish(state, 'rejected', { feedback: 'redo' });
    expect(stepProgress(state)).toMatchObject({ done: 3, total: 7 });
    step(state);
    finish(state, 'done');
    expect(stepProgress(state)).toEqual({
      done: 4,
      total: 7,
      current: { step: 'review', name: 'Reviewer', number: 5 },
    });
  });

  it('counts a merged group after a return by all its passes', () => {
    const state = run(1);
    sentBack(state, 2);
    for (let index = 0; index < 3; index += 1) {
      step(state);
      finish(state, 'done');
    }
    findGroup(state, 'group-1')!.status = 'merged';
    expect(stepProgress(state)).toEqual({ done: 6, total: 6, current: null });
  });

  it('does not count a skipped step', () => {
    const state = run(1, { skip: ['qa'] });
    expect(stepProgress(state)).toEqual({
      done: 0,
      total: 3,
      current: { step: 'plan', name: 'Planner', number: 1 },
    });
  });

  it('sets the current step only for a single group', () => {
    expect(stepProgress(run(2)).current).toBeNull();
    expect(stepProgress(run(1)).current).toEqual({ step: 'plan', name: 'Planner', number: 1 });
  });

  it('has no current step when the single group passed all steps', () => {
    const state = run(1);
    findGroup(state, 'group-1')!.status = 'merged';
    expect(stepProgress(state)).toEqual({ done: 4, total: 4, current: null });
  });

  it('gives 0 of 0 while the task is split', () => {
    const state = run(1);
    state.groups = [];
    expect(stepProgress(state)).toEqual({ done: 0, total: 0, current: null });
  });

  it('gives 0 of 0 when the pipeline is missing', () => {
    const state = run(1);
    state.run.pipeline = 'gone';
    expect(stepProgress(state)).toEqual({ done: 0, total: 0, current: null });
  });
});
