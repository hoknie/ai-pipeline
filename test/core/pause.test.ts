import { describe, expect, it } from 'vitest';

import {
  Rejection,
  addItem,
  describeFailReason,
  dispatch,
  newGroup,
  advance,
  emptyQueue,
  occupiesSlot,
  pauseRun,
  planDispatch,
  removeItem,
  retryableGroups,
  startQueue,
  transition,
  type Effect,
  type Queue,
  type RunState,
} from '../../src/core/index.ts';

import { finish, group, run, runningAttempt, step } from './helpers.ts';

function queueWith(state: RunState): Queue {
  const queue = emptyQueue('/repo', 1);
  queue.runs.push(state.run.id);
  return queue;
}

const lookupOf =
  (...states: RunState[]) =>
  (id: string): RunState | undefined =>
    states.find((state) => state.run.id === id);

describe('hold event', () => {
  it('sets and lifts the hold', () => {
    const state = run(1);
    transition(state, { kind: 'hold', hold: 'paused' }, 2);
    expect(state.run.hold).toBe('paused');
    transition(state, { kind: 'hold', hold: null }, 3);
    expect(state.run.hold).toBeNull();
  });

  it('keeps the hold of a failed run and rejects it for a finished run without one', () => {
    const state = run(1);
    transition(state, { kind: 'hold', hold: 'paused' }, 2);
    step(state);
    group(state).status = 'failed';
    transition(state, { kind: 'cancel', group: 'gruppa-1' }, 5);
    expect(state.run.finishedAt).not.toBeNull();
    expect(retryableGroups(state)).toEqual(['gruppa-1']);
    expect(state.run.hold).toBe('paused');

    const other = run(1, { id: 'run000000002' });
    other.groups.forEach((g) => (g.status = 'cancelled'));
    other.run.finishedAt = 5;
    expect(() => transition(other, { kind: 'hold', hold: 'paused' }, 6)).toThrow(Rejection);
    expect(() => transition(other, { kind: 'hold', hold: null }, 6)).not.toThrow();
  });

  it('drops the hold of a finished run with nothing to retry', () => {
    const state = run(1);
    state.run.hold = 'paused';
    state.groups.forEach((g) => (g.status = 'merged'));
    transition(state, { kind: 'hold', hold: 'paused' }, 5);
    expect(state.run.finishedAt).not.toBeNull();
    expect(state.run.hold).toBeNull();
  });
});

describe('planDispatch with a hold', () => {
  it('starts nothing of a held run and starts it again after the hold is lifted', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    state.run.hold = 'paused';
    const held = planDispatch([state], 1500);
    expect(held.start).toEqual([]);
    expect(held.waits.size).toBe(0);
    state.run.hold = null;
    expect(planDispatch([state], 1500).start.length).toBeGreaterThan(0);
  });
});

describe('planDispatch with a hold and delivery groups', () => {
  it('still starts a queued message group of a held run, but not its worker groups', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    state.message = newGroup('message', 'Сообщение', 'сообщение', 100);
    state.run.hold = 'paused';
    const slugs = planDispatch([state], 1500).start.map((entry) => entry.group.slug);
    expect(slugs).toEqual(['message']);
  });
});

describe('pauseRun', () => {
  it('moves the run to the end of the queue and frees its place', () => {
    const state = run(1);
    const queue = queueWith(state);
    addItem(queue, { workflow: 'feature', task: 'B' }, 'q1', 2);
    queue.acknowledged.push(`${state.run.id}/gruppa-1/failed/1`);
    const item = pauseRun(queue, state, 'q2', 3);
    expect(queue.runs).toEqual([]);
    expect(queue.acknowledged).toEqual([]);
    expect(queue.items.map((entry) => entry.id)).toEqual(['q1', 'q2']);
    expect(item.run).toBe(state.run.id);
  });

  it('refuses a finished run, a paused run and a run already in the queue', () => {
    const queue = emptyQueue('/repo', 1);
    const done = run(1);
    done.run.finishedAt = 4;
    expect(() => pauseRun(queue, done, 'q1', 5)).toThrow('run has nothing to pause');
    const held = run(1, { id: 'run000000002' });
    held.run.hold = 'paused';
    expect(() => pauseRun(queue, held, 'q1', 5)).toThrow('run is already paused');
    const state = run(1, { id: 'run000000003' });
    pauseRun(queue, state, 'q1', 5);
    expect(() => pauseRun(queue, state, 'q2', 6)).toThrow('run is already in the queue');
  });
});

describe('queue with a held run', () => {
  it('does not give a place to a held run and does not stop on its failure', () => {
    for (const skipFailed of [false, true]) {
      const state = run(1);
      const queue = queueWith(state);
      queue.skipFailed = skipFailed;
      startQueue(queue, [state], 2);
      pauseRun(queue, state, 'q1', 3);
      state.run.hold = 'paused';
      expect(occupiesSlot(state)).toBe(false);
      step(state);
      group(state).status = 'failed';
      advance(queue, [state], lookupOf(state), 4);
      expect(queue.status).not.toBe('stopped');
      expect(queue.skipped).toEqual([]);
      expect(queue.runs).toEqual([]);
      expect(queue.items.map((item) => item.id)).toEqual(['q1']);
    }
  });

  it('does not skip a held run that was in the skipped list', () => {
    const state = run(1);
    state.run.hold = 'paused';
    step(state);
    group(state).status = 'failed';
    const queue = emptyQueue('/repo', 1);
    queue.skipped.push(state.run.id);
    queue.runs.push(state.run.id);
    queue.skipFailed = true;
    startQueue(queue, [], 2);
    advance(queue, [state], lookupOf(state), 4);
    expect(queue.stop).toBeNull();
    expect(queue.runs).toEqual([]);
  });

  it('removes the return item of a run that finished with nothing to retry', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    pauseRun(queue, state, 'q1', 3);
    state.run.finishedAt = 5;
    state.groups.forEach((g) => (g.status = 'merged'));
    advance(queue, [], lookupOf(state), 6);
    expect(queue.items).toEqual([]);
  });

  it('keeps the item of a finished held run with failed groups behind the others', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'B' }, 'q2', 2);
    pauseRun(queue, state, 'q1', 3);
    state.run.hold = 'paused';
    state.run.finishedAt = 5;
    group(state).status = 'failed';
    expect(queue.items.map((item) => item.id)).toEqual(['q2', 'q1']);
    startQueue(queue, [], 6);
    const { take } = advance(queue, [], lookupOf(state), 7);
    expect(take.map((item) => item.id)).toEqual(['q2']);
  });

  it('refuses to remove the item of an unfinished paused run', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    pauseRun(queue, state, 'q1', 3);
    state.run.hold = 'paused';
    expect(() => removeItem(queue, 'q1', 4, lookupOf(state))).toThrow(
      'a paused run stays in the queue; continue or cancel it',
    );
    state.run.finishedAt = 5;
    group(state).status = 'cancelled';
    removeItem(queue, 'q1', 6, lookupOf(state));
    expect(queue.items).toEqual([]);
  });
});

describe('pauseRun: where the run was', () => {
  it('takes a run out of the skipped list and puts the item last', () => {
    const state = run(1);
    step(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'B' }, 'q2', 2);
    queue.skipped.push(state.run.id);
    pauseRun(queue, state, 'q1', 3);
    expect(queue.skipped).toEqual([]);
    expect(queue.items.map((item) => item.id)).toEqual(['q2', 'q1']);
    expect(queue.items.at(-1)).toMatchObject({ run: state.run.id });
  });

  it('pauses a run that holds no place in the queue', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    pauseRun(queue, state, 'q1', 3);
    expect(queue.runs).toEqual([]);
    expect(queue.items.at(-1)).toMatchObject({ run: state.run.id });
  });
});

describe('a pause stops the running step', () => {
  const pause = (state: RunState, now = 3000) =>
    transition(state, { kind: 'hold', hold: 'paused' }, now);
  const exitOf = (
    state: RunState,
    failure: { kind: 'no_report' } | null = null,
    now = 3500,
  ): Effect[] => {
    const attempt = runningAttempt(state);
    return transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: { sessionId: 's1', usage: null, failure, outsideChanges: [] },
      },
      now,
    );
  };

  it('stops an attempt without a report', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    expect(pause(state)).toEqual([
      { kind: 'stop_attempt', run: state.run.id, group: 'gruppa-1', seq: attempt.seq },
    ]);
    expect(attempt.reason).toEqual({ kind: 'paused', at: 3000 });
    expect(describeFailReason({ kind: 'paused', at: 1 })).toBe('interrupted by a pause');
  });

  it('does not stop an attempt that reported, a second pause or a freeze', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'hold', hold: 'frozen' }, 2500);
    expect(runningAttempt(state).reason).toBeNull();
    const effects = pause(state);
    expect(effects).toHaveLength(1);
    expect(pause(state, 3100)).toEqual([]);

    const reported = run(1);
    step(reported);
    const attempt = runningAttempt(reported);
    transition(
      reported,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq: attempt.seq,
        report: { verdict: 'done', summary: 'ok', feedback: null },
      },
      2000,
    );
    expect(pause(reported)).toEqual([]);
    expect(attempt.reason).toBeNull();
  });

  it('does not stop anything when the hold is a freeze', () => {
    const state = run(1);
    step(state);
    expect(transition(state, { kind: 'hold', hold: 'frozen' }, 3000)).toEqual([]);
    expect(runningAttempt(state).reason).toBeNull();
  });

  it('returns the group to the queue on the same step and resumes the session', () => {
    const state = run(1);
    step(state);
    const stopped = runningAttempt(state);
    pause(state);
    expect(exitOf(state, { kind: 'no_report' })).toEqual([]);
    expect(stopped).toMatchObject({ status: 'cancelled', sessionId: 's1' });
    expect(group(state).status).toBe('queued');
    expect(group(state).rejections).toEqual({});
    expect(dispatch([state], 4000)).toEqual([]);
    transition(state, { kind: 'hold', hold: null }, 5000);
    dispatch([state], 5000);
    expect(runningAttempt(state)).toMatchObject({
      stepId: stopped.stepId,
      resumeSession: 's1',
    });
    expect(state.run.finishedAt).toBeNull();
  });

  it('accepts a report that arrives while stopping and commits it', () => {
    const state = run(1);
    step(state);
    pause(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq: attempt.seq,
        report: { verdict: 'done', summary: 'ok', feedback: null },
      },
      3200,
    );
    const effects = exitOf(state, { kind: 'no_report' });
    expect(effects.map((effect) => effect.kind)).toContain('commit');
    expect(attempt.status).toBe('finished');
    expect(attempt.reason).toBeNull();
  });

  it('does not fail the group on a timeout while stopping', () => {
    const state = run(1);
    step(state);
    pause(state);
    const attempt = runningAttempt(state);
    expect(
      transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: attempt.seq }, 9000),
    ).toEqual([]);
    expect(attempt.status).toBe('running');
    expect(group(state).status).toBe('running');
  });

  it('survives a restart of the daemon, while a frozen run still fails', () => {
    const state = run(1);
    step(state);
    pause(state);
    transition(state, { kind: 'interrupted' }, 4000);
    expect(group(state).status).toBe('queued');
    expect(state.run.hold).toBe('paused');
    expect(state.run.finishedAt).toBeNull();

    const frozen = run(1);
    step(frozen);
    transition(frozen, { kind: 'hold', hold: 'frozen' }, 3000);
    transition(frozen, { kind: 'interrupted' }, 4000);
    expect(group(frozen).status).toBe('failed');
    expect(group(frozen).attempts[0]?.reason).toEqual({ kind: 'interrupted' });
  });

  it('rejects a message to an attempt being stopped', () => {
    const state = run(1);
    step(state);
    pause(state);
    const attempt = runningAttempt(state);
    expect(() =>
      transition(state, { kind: 'message', group: 'gruppa-1', seq: attempt.seq, text: 'x' }, 3100),
    ).toThrow(Rejection);
  });
});
