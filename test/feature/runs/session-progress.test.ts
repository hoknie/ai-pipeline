import { describe, expect, it } from 'vitest';
import { transition } from '../../../src/feature/runs/machine/index.ts';
import { group, run, runningAttempt, step } from './helpers.ts';

describe('session progress', () => {
  it('records the first session while the process is running and keeps it after interruption', () => {
    const state = run(1);
    step(state);
    const event = {
      kind: 'attempt_session',
      group: 'group-1',
      seq: 1,
      sessionId: 'early',
    } as const;
    expect(transition(state, event, 1600)).toEqual([]);
    transition(state, { ...event, sessionId: 'other' }, 1601);
    expect(runningAttempt(state).sessionId).toBe('early');
    transition(state, { kind: 'interrupted' }, 1700);
    expect(JSON.parse(JSON.stringify(state)).groups[0].attempts[0].sessionId).toBe('early');
    transition(state, { ...event, sessionId: 'late' }, 1800);
    expect(group(state).attempts[0]?.sessionId).toBe('early');
  });

  it('ignores stale, unknown and empty session events', () => {
    const state = run(1);
    step(state);
    for (const event of [
      { group: 'missing', seq: 1, sessionId: 'foreign' },
      { group: 'group-1', seq: 99, sessionId: 'foreign' },
      { group: 'group-1', seq: 1, sessionId: '' },
    ])
      transition(state, { kind: 'attempt_session', ...event }, 1600);
    expect(runningAttempt(state).sessionId).toBeNull();
  });

  it('recovers session metadata from the drained exit after a timeout without reviving the attempt', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'timed_out', group: 'group-1', seq: 1 }, 2000);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'group-1',
        seq: 1,
        exit: { sessionId: 'drained', usage: null, failure: null, outsideChanges: [] },
      },
      2100,
    );
    expect(group(state).attempts[0]).toMatchObject({
      status: 'failed',
      sessionId: 'drained',
      reason: { kind: 'timeout' },
    });
  });
});
