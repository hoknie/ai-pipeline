import { describe, expect, it } from 'vitest';

import { AppError } from '../../../src/platform/errors/index.ts';
import { type RunState, describeFailReason } from '../../../src/feature/runs/types/index.ts';
import { type Effect, dispatch, transition } from '../../../src/feature/runs/machine/index.ts';

import { finish, group, run, runningAttempt, step } from './helpers.ts';

function send(state: RunState, text = 'используй OAuth', now = 3000): Effect[] {
  const attempt = runningAttempt(state);
  return transition(state, { kind: 'message', group: 'gruppa-1', seq: attempt.seq, text }, now);
}

function exit(state: RunState, sessionId: string | null = 's1', now = 3500): Effect[] {
  const attempt = runningAttempt(state);
  return transition(
    state,
    {
      kind: 'attempt_exited',
      group: 'gruppa-1',
      seq: attempt.seq,
      exit: { sessionId, usage: null, failure: null, outsideChanges: [] },
    },
    now,
  );
}

/** A run whose first group runs its first attempt. */
function started(): RunState {
  const state = run(1);
  step(state);
  return state;
}

describe('a message to a running attempt', () => {
  it('stops the attempt and keeps the group running until the process ends', () => {
    const state = started();
    const seq = runningAttempt(state).seq;
    const effects = send(state);
    expect(effects).toEqual([{ kind: 'stop_attempt', run: state.run.id, group: 'gruppa-1', seq }]);
    expect(group(state).status).toBe('running');
    expect(runningAttempt(state).reason).toEqual({
      kind: 'message',
      text: 'используй OAuth',
      at: 3000,
    });
  });

  it('cancels the attempt on exit and continues the step in the same session', () => {
    const state = started();
    const interrupted = runningAttempt(state);
    send(state);
    expect(exit(state)).toEqual([]);
    expect(interrupted).toMatchObject({
      status: 'cancelled',
      finishedAt: 3500,
      sessionId: 's1',
    });
    expect(group(state).status).toBe('queued');
    const [start] = dispatch([state], 4000);
    expect(start).toMatchObject({ kind: 'start_attempt', group: 'gruppa-1' });
    const next = runningAttempt(state);
    expect(next).toMatchObject({
      stepId: interrupted.stepId,
      resumeSession: 's1',
      round: interrupted.round + 1,
    });
    expect(next.input.message).toEqual({ text: 'используй OAuth', at: 3000 });
    expect(interrupted.input.message).toBeUndefined();
  });

  it('takes the session that came only with the exit', () => {
    const state = started();
    expect(runningAttempt(state).sessionId).toBeNull();
    send(state);
    exit(state, 'late-session');
    dispatch([state], 4000);
    expect(runningAttempt(state).resumeSession).toBe('late-session');
  });

  it('runs the continued attempt to the end like any other', () => {
    const state = started();
    send(state);
    exit(state);
    dispatch([state], 4000);
    finish(state, 'done');
    expect(group(state).attempts.map((attempt) => attempt.status)).toEqual([
      'cancelled',
      'finished',
    ]);
    expect(group(state).pending?.stepIndex).toBe(1);
    expect(group(state).pending?.message ?? null).toBeNull();
  });

  it('describes the reason', () => {
    expect(describeFailReason({ kind: 'message', text: 'x', at: 1 })).toBe(
      'interrupted by a message',
    );
  });

  it('refuses a message to an attempt that is not running', () => {
    const state = started();
    finish(state, 'done');
    expect(() =>
      transition(state, { kind: 'message', group: 'gruppa-1', seq: 1, text: 'x' }, 3000),
    ).toThrow(AppError);
    expect(() =>
      transition(state, { kind: 'message', group: 'gruppa-1', seq: 1, text: 'x' }, 3000),
    ).toThrow('attempt 1 is not running');
  });

  it('refuses a message to an attempt that already reported', () => {
    const state = started();
    const seq = runningAttempt(state).seq;
    transition(
      state,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq,
        report: { verdict: 'done', summary: 'ok', feedback: null },
      },
      2000,
    );
    expect(() => send(state)).toThrow('already reported');
  });

  it('refuses a second message while the attempt is being interrupted', () => {
    const state = started();
    send(state);
    expect(() => send(state, 'ещё')).toThrow('already being interrupted');
    expect(runningAttempt(state).reason).toMatchObject({ text: 'используй OAuth' });
  });

  it('rejects a report that arrives after the message', () => {
    const state = started();
    const seq = runningAttempt(state).seq;
    send(state);
    expect(() =>
      transition(
        state,
        {
          kind: 'report',
          group: 'gruppa-1',
          seq,
          report: { verdict: 'done', summary: 'ok', feedback: null },
        },
        3100,
      ),
    ).toThrow('interrupted by a message');
    expect(runningAttempt(state).report).toBeNull();
    expect(state.groups[0]?.rejections).toEqual({});
  });

  it('does not fail the group on a timeout while it is being interrupted', () => {
    const state = started();
    const seq = runningAttempt(state).seq;
    send(state);
    expect(transition(state, { kind: 'timed_out', group: 'gruppa-1', seq }, 3100)).toEqual([]);
    expect(group(state).status).toBe('running');
    exit(state);
    expect(group(state).status).toBe('queued');
  });

  it('continues the step after a restart of the daemon instead of failing it', () => {
    const state = started();
    send(state);
    transition(state, { kind: 'interrupted' }, 3600);
    expect(group(state).attempts[0]).toMatchObject({ status: 'cancelled', finishedAt: 3600 });
    expect(group(state).status).toBe('queued');
    expect(group(state).pending).toMatchObject({
      resume: true,
      message: { text: 'используй OAuth', at: 3000 },
    });
  });

  it('loses the message when the group is cancelled meanwhile', () => {
    const state = started();
    send(state);
    transition(state, { kind: 'cancel', group: 'gruppa-1' }, 3100);
    expect(group(state).status).toBe('cancelled');
    expect(group(state).attempts[0]?.status).toBe('cancelled');
    expect(group(state).pending?.message ?? null).toBeNull();
  });
});
