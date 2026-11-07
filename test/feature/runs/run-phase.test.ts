import { describe, expect, it } from 'vitest';

import { runPhase } from '../../../src/feature/runs/types/index.ts';
import { summarize } from '../../../src/feature/runs/services/index.ts';

import { group, run, step } from './helpers.ts';

function needsHuman(state: ReturnType<typeof run>, slug: string) {
  group(state, slug).status = 'needs_human';
}

describe('run phase needs_human', () => {
  it('is needs_human when one group waits and another is running', () => {
    const state = run(2);
    group(state, 'gruppa-2').status = 'running';
    needsHuman(state, 'gruppa-1');
    expect(runPhase(state)).toBe('needs_human');
    expect(summarize(state)).toMatchObject({ state: 'needs_human', waiting: 1, finished: false });
  });

  it('counts a waiting split group', () => {
    const state = run(2);
    state.split = { ...group(state), slug: '_split', status: 'needs_human', attempts: [] };
    needsHuman(state, 'gruppa-1');
    expect(runPhase(state)).toBe('needs_human');
    expect(summarize(state).waiting).toBe(2);
  });

  it('counts only the split when it alone waits', () => {
    const state = run(1);
    state.split = { ...group(state), slug: '_split', status: 'needs_human', attempts: [] };
    expect(runPhase(state)).toBe('needs_human');
    expect(summarize(state).waiting).toBe(1);
  });

  it('is active again after the answer', () => {
    const state = run(1);
    step(state);
    group(state).status = 'needs_human';
    expect(runPhase(state)).toBe('needs_human');
    group(state).status = 'running';
    expect(runPhase(state)).toBe('active');
    expect(summarize(state).waiting).toBe(0);
  });

  it('is never needs_human for a finished run', () => {
    const state = run(1);
    group(state).status = 'merged';
    expect(runPhase(state)).toBe('finished');
  });
});

describe('run phase failed', () => {
  it('is failed when the split step failed', () => {
    const state = run(1);
    state.split = { ...group(state), slug: '_split', status: 'failed', attempts: [] };
    group(state).status = 'merged';
    expect(runPhase(state)).toBe('failed');
  });

  it('is failed when a merged group has apply_failed, finished once applied', () => {
    const state = run(1);
    group(state).status = 'merged';
    group(state).delivery = { ...group(state).delivery, state: 'apply_failed' };
    expect(runPhase(state)).toBe('failed');
    group(state).delivery = { ...group(state).delivery, state: 'applied' };
    expect(runPhase(state)).toBe('finished');
  });

  it('is active again after a retry of the failed group', () => {
    const state = run(2);
    group(state, 'gruppa-1').status = 'failed';
    group(state, 'gruppa-2').status = 'merged';
    expect(runPhase(state)).toBe('failed');
    group(state, 'gruppa-1').status = 'queued';
    expect(runPhase(state)).toBe('active');
  });

  it('prefers cancelled over failed', () => {
    const state = run(2);
    group(state, 'gruppa-1').status = 'failed';
    group(state, 'gruppa-2').status = 'cancelled';
    expect(runPhase(state)).toBe('cancelled');
  });

  it('is finished for merged groups with pending or applied delivery', () => {
    const state = run(2);
    group(state, 'gruppa-1').status = 'merged';
    group(state, 'gruppa-2').status = 'merged';
    group(state, 'gruppa-2').delivery = { ...group(state, 'gruppa-2').delivery, state: 'applied' };
    expect(runPhase(state)).toBe('finished');
  });

  it('ignores a failed resolver when no group has apply_failed', () => {
    const state = run(1);
    group(state).status = 'merged';
    state.resolve = { ...group(state), slug: '_resolve', status: 'failed', attempts: [] };
    expect(runPhase(state)).toBe('finished');
  });
});
