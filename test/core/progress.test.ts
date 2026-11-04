import { describe, expect, it } from 'vitest';

import { findGroup, stepProgress } from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, run, step } from './helpers.ts';

describe('stepProgress', () => {
  it('counts every step of merged, merging and conflict groups', () => {
    const state = run(3);
    findGroup(state, 'gruppa-1')!.status = 'merged';
    findGroup(state, 'gruppa-2')!.status = 'merging';
    findGroup(state, 'gruppa-3')!.status = 'conflict';
    expect(stepProgress(state)).toEqual({ done: 12, total: 12, current: null });
  });

  it('counts a queued group by its pending step, or 0 without attempts', () => {
    const state = run(2);
    findGroup(state, 'gruppa-2')!.pending!.stepIndex = 2;
    expect(stepProgress(state)).toEqual({ done: 2, total: 8, current: null });
  });

  it('counts a running group by the step of its last attempt', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    expect(stepProgress(state)).toEqual({
      done: 1,
      total: 4,
      current: { step: 'code', name: 'Кодировщик', number: 2 },
    });
  });

  it('counts failed, cancelled and needs_human groups by the last attempt', () => {
    for (const status of ['failed', 'cancelled', 'needs_human'] as const) {
      const state = run(1);
      step(state);
      finish(state, 'done');
      step(state);
      findGroup(state, 'gruppa-1')!.status = status;
      expect(stepProgress(state).done).toBe(1);
    }
  });

  function sentBack(state: ReturnType<typeof run>, steps: number) {
    for (let index = 0; index < steps; index += 1) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    finish(state, 'rejected', { feedback: 'переделать' });
  }

  it('keeps the progress when a group returns to an earlier step', () => {
    const state = run(1);
    sentBack(state, 2);
    expect(stepProgress(state)).toEqual({
      done: 2,
      total: 4,
      current: { step: 'code', name: 'Кодировщик', number: 2 },
    });
  });

  it('does not reset the progress on a return to the first step', () => {
    const state = run(1, {
      configText: CONFIG_TEXT.replace('        - { id: plan, specialist: plan }\n', ''),
    });
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'rejected', { feedback: 'переделать' });
    const progress = stepProgress(state);
    expect(progress.done).toBe(1);
    expect(progress.current).toMatchObject({ step: 'code', number: 1 });
  });

  it('does not grow beyond the maximum on a repeated pass, then grows on a new step', () => {
    const state = run(1);
    sentBack(state, 2);
    const before = stepProgress(state).done;
    step(state);
    finish(state, 'done');
    expect(stepProgress(state).done).toBe(before);
    step(state);
    expect(stepProgress(state).done).toBe(before);
    finish(state, 'done');
    step(state);
    expect(stepProgress(state).done).toBe(before + 1);
  });

  it('counts failed and cancelled groups after a return by the furthest step', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const state = run(1);
      sentBack(state, 2);
      findGroup(state, 'gruppa-1')!.status = status;
      expect(stepProgress(state).done).toBe(2);
    }
  });

  it('does not count a skipped step', () => {
    const state = run(1, { skip: ['qa'] });
    expect(stepProgress(state)).toEqual({
      done: 0,
      total: 3,
      current: { step: 'plan', name: 'Планировщик', number: 1 },
    });
  });

  it('sets the current step only for a single group', () => {
    expect(stepProgress(run(2)).current).toBeNull();
    expect(stepProgress(run(1)).current).toEqual({ step: 'plan', name: 'Планировщик', number: 1 });
  });

  it('has no current step when the single group passed all steps', () => {
    const state = run(1);
    findGroup(state, 'gruppa-1')!.status = 'merged';
    expect(stepProgress(state)).toEqual({ done: 4, total: 4, current: null });
  });

  it('gives 0 of 0 while the task is split', () => {
    const state = run(1);
    state.groups = [];
    expect(stepProgress(state)).toEqual({ done: 0, total: 0, current: null });
  });

  it('gives 0 of 0 when the workflow is missing', () => {
    const state = run(1);
    state.run.workflow = 'gone';
    expect(stepProgress(state)).toEqual({ done: 0, total: 0, current: null });
  });
});
