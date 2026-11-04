import { describe, expect, it } from 'vitest';

import {
  addItem,
  advance,
  dependencyState,
  emptyQueue,
  itemStarted,
  occupiesSlot,
  pauseRun,
  removeItem,
  startQueue,
  transition,
  type Queue,
  type RunState,
} from '../../src/core/index.ts';

import { group, run, step } from './helpers.ts';

function queueOf(...tasks: string[]): Queue {
  const queue = emptyQueue('/repo', 1);
  tasks.forEach((task, index) => addItem(queue, { workflow: 'feature', task }, `q${index + 1}`, 2));
  return queue;
}

const lookupOf =
  (...states: RunState[]) =>
  (id: string): RunState | undefined =>
    states.find((state) => state.run.id === id);

/** A running queue where run `a` holds the only place, B and C wait. */
function setup(): { queue: Queue; a: RunState } {
  const queue = queueOf('B', 'C');
  queue.status = 'running';
  const a = run(1, { id: 'a' });
  step(a);
  queue.runs.push('a');
  return { queue, a };
}

function pause(queue: Queue, state: RunState, id = 'ret'): void {
  pauseRun(queue, state, id, 7);
  transition(state, { kind: 'hold', hold: 'paused' }, 7);
}

describe('pause of a run', () => {
  it('frees the place and puts the return item last', () => {
    const { queue, a } = setup();
    pause(queue, a);
    expect(queue.runs).toEqual([]);
    expect(queue.items.map((item) => item.id)).toEqual(['q1', 'q2', 'ret']);
    expect(queue.items.at(-1)).toMatchObject({ run: 'a', postponed: false });
    expect(a.run.hold).toBe('paused');
    expect(occupiesSlot(a)).toBe(false);
  });

  it('takes the run off the skipped list and forgets its problems', () => {
    const { queue, a } = setup();
    queue.runs = [];
    queue.skipped = ['a'];
    queue.acknowledged = ['a/gruppa-1/failed/1', 'b/x/failed/1'];
    pause(queue, a);
    expect(queue.skipped).toEqual([]);
    expect(queue.acknowledged).toEqual(['b/x/failed/1']);
  });

  it('keeps the state of the queue and gives the place to the next task', () => {
    const { queue, a } = setup();
    pause(queue, a);
    const { take } = advance(queue, [], lookupOf(a), 8);
    expect(queue.status).toBe('running');
    expect(queue.stop).toBeNull();
    expect(take.map((item) => item.id)).toEqual(['q1']);
  });

  it('keeps a stopped queue stopped with its reason', () => {
    const { queue, a } = setup();
    queue.status = 'stopped';
    queue.stop = { kind: 'problem', run: 'x', group: null, reason: 'failed' };
    pause(queue, a);
    expect(queue).toMatchObject({ status: 'stopped', stop: { kind: 'problem', run: 'x' } });
  });

  it('refuses a finished run, a paused run and a run with an item', () => {
    const { queue, a } = setup();
    const finished = run(1, { id: 'f' });
    group(finished).status = 'merged';
    finished.run.finishedAt = 5;
    expect(() => pauseRun(queue, finished, 'r', 7)).toThrow('run has nothing to pause');
    pause(queue, a);
    expect(() => pauseRun(queue, a, 'r2', 8)).toThrow('run is already paused');
    const other = run(1, { id: 'o' });
    step(other);
    addItem(queue, { workflow: 'feature', task: 't' }, 'ret2', 3).run = 'o';
    expect(() => pauseRun(queue, other, 'r3', 8)).toThrow('run is already in the queue');
    expect(queue.items.filter((item) => item.run !== null)).toHaveLength(2);
  });
});

describe('a run on pause and the queue', () => {
  it('does not stop the queue and is not skipped when its group fails', () => {
    const { queue, a } = setup();
    queue.skipFailed = true;
    startQueue(queue, [a], 3);
    pause(queue, a);
    group(a).status = 'failed';
    advance(queue, [a], lookupOf(a), 9);
    expect(queue).toMatchObject({ status: 'running', stop: null, skipped: [] });
    expect(queue.items.at(-1)?.run).toBe('a');
  });

  it('keeps the item of a run that failed on pause as the last one and does not retake it', () => {
    const queue = queueOf('B');
    queue.status = 'running';
    const a = run(1, { id: 'a' });
    step(a);
    pause(queue, a);
    transition(a, { kind: 'cancel', group: null }, 9);
    group(a).status = 'failed';
    a.run.finishedAt = 9;
    expect(a.run.hold).toBe('paused');
    const { take } = advance(queue, [], lookupOf(a), 10);
    expect(take.map((item) => item.id)).toEqual(['q1']);
    expect(queue.items.map((item) => item.run)).toEqual([null, 'a']);
  });

  it('removes the item of a run on pause that finished with nothing to retry', () => {
    const queue = queueOf('B');
    const a = run(1, { id: 'a' });
    step(a);
    pause(queue, a);
    group(a).status = 'merged';
    transition(a, { kind: 'hold', hold: null }, 9);
    a.run.finishedAt = 9;
    advance(queue, [], lookupOf(a), 10);
    expect(queue.items.map((item) => item.id)).toEqual(['q1']);
  });

  it('makes a dependent task wait', () => {
    const { queue, a } = setup();
    addItem(queue, { workflow: 'feature', task: 'D', after: ['a'] }, 'q4', 3);
    pause(queue, a);
    group(a).status = 'failed';
    expect(dependencyState(queue, 'a', lookupOf(a))).toBe('waiting');
  });
});

describe('removing the item of a paused run', () => {
  it('is refused for an unfinished run', () => {
    const { queue, a } = setup();
    pause(queue, a);
    expect(() => removeItem(queue, 'ret', 9, lookupOf(a))).toThrow(
      'a paused run stays in the queue; continue or cancel it',
    );
    expect(queue.items.some((item) => item.id === 'ret')).toBe(true);
  });

  it('is allowed for a finished run', () => {
    const { queue, a } = setup();
    pause(queue, a);
    group(a).status = 'failed';
    a.run.finishedAt = 9;
    removeItem(queue, 'ret', 10, lookupOf(a));
    expect(queue.items.some((item) => item.id === 'ret')).toBe(false);
  });
});

describe('a started item', () => {
  it('still starts through itemStarted', () => {
    const { queue } = setup();
    itemStarted(queue, 'q1', 'z', 9);
    expect(queue.runs).toEqual(['a', 'z']);
  });
});
