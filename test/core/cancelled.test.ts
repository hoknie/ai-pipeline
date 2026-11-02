import { describe, expect, it } from 'vitest';

import {
  runPhase,
  summarize,
  transition,
  type Effect,
  type RunState,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from './helpers.ts';

const SPLIT_CONFIG = CONFIG_TEXT.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

function kinds(effects: Effect[]): string[] {
  return effects.map((effect) => effect.kind);
}

function cancel(state: RunState, slug: string | null = null) {
  transition(state, { kind: 'cancel', group: slug }, 10);
}

function retry(state: RunState, slug = 'gruppa-1') {
  return transition(state, { kind: 'retry', group: slug }, 11);
}

function withCancelledMessage(state: RunState) {
  group(state).status = 'merged';
  state.message = { ...group(state), slug: '_message', status: 'cancelled', attempts: [] };
}

describe('run phase', () => {
  it('is cancelled after cancelling a run and active again after a retry', () => {
    const state = run(1);
    expect(runPhase(state)).toBe('active');
    step(state);
    cancel(state);
    expect(runPhase(state)).toBe('cancelled');
    expect(summarize(state)).toMatchObject({ finished: true, state: 'cancelled' });
    retry(state);
    expect(runPhase(state)).toBe('active');
    expect(state.run.finishedAt).toBeNull();
  });

  it('is failed for a failed group', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 5);
    expect(runPhase(state)).toBe('failed');
    expect(summarize(state)).toMatchObject({ finished: true, state: 'failed' });
  });

  it('is cancelled when one of three groups is cancelled', () => {
    const state = run(3);
    cancel(state, 'gruppa-1');
    for (const slug of ['gruppa-2', 'gruppa-3']) group(state, slug).status = 'merged';
    expect(runPhase(state)).toBe('cancelled');
  });

  it('ignores a cancelled message group', () => {
    const state = run(1);
    withCancelledMessage(state);
    expect(runPhase(state)).toBe('finished');
  });

  it('is cancelled when the split step is cancelled', () => {
    const state = run(1, { split: true, configText: SPLIT_CONFIG });
    step(state);
    cancel(state);
    expect(runPhase(state)).toBe('cancelled');
  });
});

describe('retry of a cancelled group', () => {
  it('resumes the interrupted step with the same index', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    cancel(state);
    retry(state);
    expect(group(state)).toMatchObject({ status: 'queued', reason: null });
    expect(group(state).pending).toMatchObject({ stepIndex: 1, resume: false });
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
    expect(group(state).attempts.filter((candidate) => candidate.stepId === 'plan')).toHaveLength(
      1,
    );
  });

  it('starts from the first step when cancelled before it', () => {
    const state = run(1);
    cancel(state);
    retry(state);
    step(state);
    expect(runningAttempt(state).stepId).toBe('plan');
  });

  it('returns a group cancelled during a question to the question', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'OAuth или пароль?' });
    cancel(state);
    retry(state);
    expect(group(state)).toMatchObject({ status: 'needs_human', question: 'OAuth или пароль?' });
  });

  it('queues the merge again for a group cancelled while merging', () => {
    const state = run(1);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    expect(group(state).status).toBe('merging');
    cancel(state);
    expect(group(state).status).toBe('cancelled');
    const effects = retry(state);
    expect(group(state).status).toBe('merging');
    expect(kinds(effects)).toEqual(['merge']);
  });

  it('runs the split step again', () => {
    const state = run(1, { split: true, configText: SPLIT_CONFIG });
    step(state);
    cancel(state);
    retry(state, '_split');
    step(state);
    expect(runningAttempt(state, '_split').seq).toBe(2);
  });

  it('refuses a cancelled message group and points to apply', () => {
    const state = run(1);
    withCancelledMessage(state);
    expect(() => retry(state, '_message')).toThrow('aip run apply');
  });

  it.each(['_message', '_resolve'] as const)('refuses a failed %s group', (slug) => {
    const state = run(1);
    withCancelledMessage(state);
    const delivery = { ...state.message!, slug, status: 'failed' as const };
    if (slug === '_message') state.message = delivery;
    else state.resolve = delivery;
    expect(() => retry(state, slug)).toThrow('is failed; delivery is retried with `aip run apply`');
    expect(delivery.status).toBe('failed');
  });
});
