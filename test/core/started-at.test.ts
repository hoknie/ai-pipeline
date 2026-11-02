import { describe, expect, it } from 'vitest';

import { runStartedAt } from '../../src/core/index.ts';

import { finish, group, run, step } from './helpers.ts';

describe('runStartedAt', () => {
  it('is null while no attempt started', () => {
    expect(runStartedAt(run(2))).toBeNull();
  });

  it('is the earliest attempt start of any group', () => {
    const state = run(2, { max: 5 });
    step(state, 1500);
    const starts = state.groups.flatMap((item) => item.attempts.map((a) => a.startedAt));
    expect(runStartedAt(state)).toBe(Math.min(...starts));
  });

  it('takes the split group into account', () => {
    const state = run(1);
    state.split = { ...group(state), slug: '_split', attempts: [] };
    group(state).attempts = [{ ...fakeAttempt(), startedAt: 900 }];
    state.split.attempts = [{ ...fakeAttempt(), startedAt: 400 }];
    expect(runStartedAt(state)).toBe(400);
  });

  it('is not moved by a later attempt', () => {
    const state = run(1);
    step(state, 1500);
    finish(state, 'rejected', { now: 1600 });
    const first = runStartedAt(state);
    expect(first).not.toBeNull();
    step(state, 1700);
    expect(runStartedAt(state)).toBe(first);
  });
});

function fakeAttempt() {
  const state = run(1);
  step(state, 1500);
  return structuredClone(group(state).attempts[0]!);
}
