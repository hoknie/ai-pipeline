import { describe, expect, it } from 'vitest';

import {
  addItem,
  advance,
  editItem,
  emptyQueue,
  itemStarted,
  pauseQueue,
  queueWakeAt,
  removeItem,
  returnRun,
  setQueueSettings,
  startQueue,
  transition,
  type OnLimit,
  type Queue,
  type RunState,
} from '../../src/core/index.ts';

import { group, run, runningAttempt, step } from './helpers.ts';

const RESET = 50_000;

function queueOf(...tasks: string[]): Queue {
  const queue = emptyQueue('/repo', 1);
  tasks.forEach((task, index) => addItem(queue, { workflow: 'feature', task }, `q${index + 1}`, 2));
  return queue;
}

/** A run of the queue with its first step running. */
function queueRun(queue: Queue, id = 'run000000001'): RunState {
  const state = run(1, { id });
  queue.runs.push(state.run.id);
  step(state);
  return state;
}

function lookupOf(...states: RunState[]) {
  return (id: string) => states.find((state) => state.run.id === id);
}

function tick(queue: Queue, states: RunState[], now = 3000) {
  return advance(queue, states, lookupOf(...states), now).take.map((item) => item.id);
}

function exit(
  state: RunState,
  failure: { kind: 'usage_limit'; resetsAt: number } | null,
  onLimit?: OnLimit,
) {
  const attempt = runningAttempt(state);
  transition(
    state,
    {
      kind: 'attempt_exited',
      group: 'gruppa-1',
      seq: attempt.seq,
      exit: {
        sessionId: 's',
        usage: null,
        failure,
        outsideChanges: [],
        ...(onLimit ? { onLimit } : {}),
      },
    },
    2000,
  );
}

const hitLimit = (state: RunState, onLimit: OnLimit = 'wait') =>
  exit(state, { kind: 'usage_limit', resetsAt: RESET }, onLimit);
const failNoReport = (state: RunState) => exit(state, null);

describe('onLimit setting', () => {
  it('is wait in a new queue', () => {
    expect(emptyQueue('/repo', 1).onLimit).toBe('wait');
  });

  it('changes only onLimit', () => {
    const queue = queueOf('a');
    setQueueSettings(queue, { parallel: 2 }, 5);
    setQueueSettings(queue, { onLimit: 'stop' }, 6);
    expect(queue).toMatchObject({
      onLimit: 'stop',
      parallel: 2,
      status: 'stopped',
      autopilot: false,
    });
  });

  it('refuses an unknown value without a change', () => {
    const queue = queueOf('a');
    expect(() => setQueueSettings(queue, { onLimit: 'retry' as OnLimit }, 5)).toThrow(
      'onLimit must be one of: wait, stop',
    );
    expect(queue.onLimit).toBe('wait');
  });
});

describe('a cancel stops the queue', () => {
  it('stops even with skipFailed and does not skip the run', () => {
    const queue = queueOf('b');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    transition(a, { kind: 'cancel', group: null }, 2500);
    expect(tick(queue, [a])).toEqual([]);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toMatchObject({ kind: 'problem', run: a.run.id, reason: 'cancelled' });
    expect(queue.skipped).toEqual([]);
  });
});

describe('stop on a usage limit', () => {
  it('stops with an automatic resume, then starts by itself at the reset', () => {
    const queue = queueOf('b', 'c');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    hitLimit(a);
    expect(tick(queue, [a])).toEqual([]);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toEqual({
      kind: 'limit',
      run: a.run.id,
      group: 'gruppa-1',
      runtime: 'claude',
      resetsAt: RESET,
      autoResume: true,
    });
    expect(group(a).status).toBe('queued');
    expect(queueWakeAt(queue)).toBe(RESET);
    expect(tick(queue, [a], RESET - 1)).toEqual([]);
    queue.parallel = 2;
    expect(tick(queue, [a], RESET)).toEqual(['q1']);
    expect(queue.status).toBe('running');
    expect(queue.stop).toBeNull();
  });

  it('stops without a resume and never skips the run with onLimit stop', () => {
    const queue = queueOf('b');
    queue.skipFailed = true;
    queue.onLimit = 'stop';
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    hitLimit(a, 'stop');
    expect(group(a).status).toBe('failed');
    expect(tick(queue, [a])).toEqual([]);
    expect(queue.stop).toMatchObject({ kind: 'limit', autoResume: false });
    expect(queue.skipped).toEqual([]);
    expect(tick(queue, [a], RESET + 1)).toEqual([]);
    expect(queue.status).toBe('stopped');
  });

  it('does not start by itself after a pause', () => {
    const queue = queueOf('b');
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    hitLimit(a);
    tick(queue, [a]);
    pauseQueue(queue, 4000);
    expect(queue.stop).toMatchObject({ kind: 'limit', autoResume: false });
    expect(queueWakeAt(queue)).toBeNull();
    expect(tick(queue, [a], RESET + 1)).toEqual([]);
    expect(queue.status).toBe('stopped');
  });

  it('records a limit in a paused queue without a resume', () => {
    const queue = queueOf('b');
    const a = queueRun(queue);
    hitLimit(a);
    tick(queue, [a]);
    expect(queue.stop).toMatchObject({ kind: 'limit', autoResume: false });
    expect(tick(queue, [a], RESET + 1)).toEqual([]);
  });

  it('stops again when the group hits the limit after the resume', () => {
    const queue = queueOf('b');
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    hitLimit(a);
    tick(queue, [a]);
    tick(queue, [a], RESET);
    expect(queue.status).toBe('running');
    step(a, RESET + 10);
    hitLimit(a);
    tick(queue, [a], RESET + 20);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toMatchObject({ kind: 'limit' });
  });
});

describe('a paused queue creates no runs', () => {
  it('skips a failed run but takes nothing', () => {
    const queue = queueOf('b', 'c');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    pauseQueue(queue, 4);
    failNoReport(a);
    expect(tick(queue, [a])).toEqual([]);
    expect(queue.skipped).toEqual([a.run.id]);
    expect(queue.status).toBe('stopped');
  });

  it('takes nothing after the user cancels its runs', () => {
    const queue = queueOf('c', 'd');
    queue.parallel = 2;
    startQueue(queue, [], 3);
    const a = queueRun(queue, 'run000000001');
    const b = queueRun(queue, 'run000000002');
    pauseQueue(queue, 4);
    transition(a, { kind: 'cancel', group: null }, 2500);
    expect(tick(queue, [a, b])).toEqual([]);
    transition(b, { kind: 'cancel', group: null }, 2600);
    expect(tick(queue, [a, b])).toEqual([]);
    expect(queue.items).toHaveLength(2);
  });
});

describe('return a run to the queue', () => {
  function skippedRun(): { queue: Queue; a: RunState } {
    const queue = queueOf('b', 'c');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    const a = queueRun(queue);
    failNoReport(a);
    tick(queue, [a]);
    return { queue, a };
  }

  it('puts the run first and takes it off the skipped', () => {
    const { queue, a } = skippedRun();
    queue.items.splice(0); // the first tick took q1; keep the test about the order only
    addItem(queue, { workflow: 'feature', task: 'b' }, 'q5', 5);
    const item = returnRun(queue, a, 'q9', 10);
    expect(queue.items.map((entry) => entry.id)).toEqual(['q9', 'q5']);
    expect(item).toMatchObject({ run: a.run.id, workflow: 'feature', task: null });
    expect(queue.skipped).toEqual([]);
    expect(group(a).status).toBe('failed');
  });

  it('refuses a run without failed or cancelled groups, one holding a place and a repeat', () => {
    const queue = queueOf();
    const a = queueRun(queue);
    expect(() => returnRun(queue, a, 'q9', 10)).toThrow('run has no failed or cancelled groups');
    failNoReport(a);
    expect(() => returnRun(queue, a, 'q9', 10)).toThrow('run already holds a place in the queue');
    queue.runs = [];
    returnRun(queue, a, 'q9', 10);
    expect(() => returnRun(queue, a, 'q8', 11)).toThrow('run is already in the queue');
  });

  it('keeps the task of a returned run, but moves and removes it', () => {
    const { queue, a } = skippedRun();
    returnRun(queue, a, 'q9', 10);
    expect(() => editItem(queue, 'q9', { task: 'другое' }, 11)).toThrow(
      'a returned run keeps its own task',
    );
    editItem(queue, 'q9', { position: queue.items.length }, 12);
    expect(queue.items.at(-1)?.id).toBe('q9');
    removeItem(queue, 'q9', 13);
    expect(queue.items.some((entry) => entry.run !== null)).toBe(false);
    expect(group(a).status).toBe('failed');
  });

  it('becomes a queue run when taken', () => {
    const { queue, a } = skippedRun();
    queue.items.splice(0);
    queue.runs = [];
    returnRun(queue, a, 'q9', 10);
    expect(tick(queue, [a], 20)).toEqual(['q9']);
    itemStarted(queue, 'q9', a.run.id, 21);
    expect(queue.runs).toEqual([a.run.id]);
    expect(queue.items).toEqual([]);
  });
});
