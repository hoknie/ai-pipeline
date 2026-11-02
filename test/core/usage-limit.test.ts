import { describe, expect, it } from 'vitest';

import {
  USAGE_LIMIT_FALLBACK_MS,
  clockTime,
  describeFailReason,
  dispatch,
  limitHolds,
  transition,
  type OnLimit,
  type RunState,
} from '../../src/core/index.ts';

import { finish, group, run, runningAttempt, step } from './helpers.ts';

const RESET = 50_000;

/** The running attempt of the group ends because the usage limit ran out. */
function hitLimit(
  state: RunState,
  options: { onLimit?: OnLimit; resetsAt?: number | null; now?: number; slug?: string } = {},
) {
  const slug = options.slug ?? 'gruppa-1';
  const attempt = runningAttempt(state, slug);
  return transition(
    state,
    {
      kind: 'attempt_exited',
      group: slug,
      seq: attempt.seq,
      exit: {
        sessionId: `session-${attempt.seq}`,
        usage: null,
        failure: {
          kind: 'usage_limit',
          resetsAt: options.resetsAt === undefined ? RESET : options.resetsAt,
        },
        outsideChanges: [],
        ...(options.onLimit ? { onLimit: options.onLimit } : {}),
      },
    },
    options.now ?? 2000,
  );
}

describe('usage limit reason', () => {
  it('describes the limit with and without a reset time', () => {
    expect(describeFailReason({ kind: 'usage_limit', resetsAt: null })).toBe('usage limit');
    expect(describeFailReason({ kind: 'usage_limit', resetsAt: RESET })).toBe(
      `usage limit, resets ${clockTime(RESET)}`,
    );
  });
});

describe('a group that ran out of the usage limit', () => {
  it('waits in queued for the same step and resumes the session with onLimit wait', () => {
    const state = run(1);
    step(state);
    hitLimit(state);
    const waiting = group(state);
    expect(waiting.status).toBe('queued');
    expect(waiting.reason).toBeNull();
    expect(waiting.pending).toMatchObject({ stepIndex: 0, resume: true });
    expect(waiting.attempts.at(-1)).toMatchObject({
      status: 'failed',
      reason: { kind: 'usage_limit', resetsAt: RESET },
    });
    expect(state.run.finishedAt).toBeNull();
  });

  it('fails with the reason usage_limit with onLimit stop, and the retry works', () => {
    const state = run(1);
    step(state);
    hitLimit(state, { onLimit: 'stop' });
    expect(group(state)).toMatchObject({
      status: 'failed',
      reason: `usage limit, resets ${clockTime(RESET)}`,
    });
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 3000);
    expect(group(state).status).toBe('queued');
  });

  it('ignores the limit when the specialist reported before it', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq: attempt.seq,
        report: { verdict: 'done', summary: 'план', feedback: null },
      },
      1800,
    );
    hitLimit(state);
    expect(group(state).attempts.at(-1)?.status).toBe('finished');
    expect(group(state).pending?.stepIndex).toBe(1);
  });

  it('does not count the limit as a rejection of the step', () => {
    const state = run(1);
    step(state);
    hitLimit(state);
    expect(group(state).rejections).toEqual({});
  });
});

describe('holding a runtime until the limit resets', () => {
  it('starts no step of the runtime in any run until the reset', () => {
    const first = run(1, { id: 'run000000001' });
    const second = run(1, { id: 'run000000002', now: 1100 });
    dispatch([first], 5, 1500);
    hitLimit(first);
    expect(dispatch([first, second], 5, 3000)).toEqual([]);
    expect(group(second).status).toBe('queued');
    expect(group(first).status).toBe('queued');
    const effects = dispatch([first, second], 5, RESET);
    expect(effects.map((effect) => effect.run)).toEqual(['run000000001', 'run000000002']);
    expect(runningAttempt(first).resumeSession).toBe('session-1');
  });

  it('holds 15 minutes after the attempt when the reset time is unknown', () => {
    const state = run(1);
    step(state);
    hitLimit(state, { resetsAt: null, now: 2000 });
    expect(limitHolds([state], 2001).get('claude')).toBe(2000 + USAGE_LIMIT_FALLBACK_MS);
    expect(dispatch([state], 5, 2000 + USAGE_LIMIT_FALLBACK_MS - 1)).toEqual([]);
    expect(dispatch([state], 5, 2000 + USAGE_LIMIT_FALLBACK_MS)).toHaveLength(1);
  });

  it('starts steps of another runtime', () => {
    const limited = run(1, { id: 'run000000001' });
    const other = run(1, { id: 'run000000002', now: 1100 });
    dispatch([limited, other], 5, 1500);
    hitLimit(limited);
    finish(other, 'done');
    const effects = dispatch([limited, other], 5, 3000);
    expect(effects).toEqual([
      { kind: 'start_attempt', run: 'run000000002', group: 'gruppa-1', seq: 2 },
    ]);
    expect(runningAttempt(other).runtime).toBe('opencode');
  });
});
