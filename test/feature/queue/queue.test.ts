import { describe, expect, it } from 'vitest';

import {
  type Queue,
  type QueueItem,
  checkReturnedPatch,
  DEFAULT_AUTOPILOT_ANSWER,
  QUEUE_PARALLEL_MAX,
  addItem,
  adoptRun,
  advance,
  canReturn,
  dismissRun,
  autopilotAnswers,
  dependencyState,
  dependencyTags,
  editItem,
  emptyQueue,
  itemFailed,
  itemReadiness,
  itemStarted,
  moveItem,
  occupiesSlot,
  pauseQueue,
  problemKeys,
  removeItem,
  runDone,
  setParallel,
  setQueueSettings,
  spreadTags,
  startQueue,
} from '../../../src/feature/queue/types/index.ts';
import {
  type RunState,
  createRun,
  runPhase,
  runProblems,
} from '../../../src/feature/runs/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';

import { config, finish, group, run, step } from '../runs/helpers.ts';

function queueOf(...tasks: string[]): Queue {
  const queue = emptyQueue('/repo', 1);
  tasks.forEach((task, index) => addItem(queue, { pipeline: 'feature', task }, `q${index + 1}`, 2));
  return queue;
}

const ids = (queue: Queue) => queue.items.map((item) => item.id);

/** A queue run that is just taken: it holds a place. */
function taken(queue: Queue, state: RunState): void {
  queue.runs.push(state.run.id);
}

function merge(state: RunState, slug = 'gruppa-1'): void {
  transition(
    state,
    { kind: 'merge_finished', group: slug, outcome: { kind: 'merged', commit: 'c1' } },
    5000,
  );
}

function toMerging(state: RunState, slug = 'gruppa-1'): void {
  for (let index = 0; index < 4; index += 1) {
    step(state);
    finish(state, 'done', { slug });
  }
}

const none = (): undefined => undefined;

describe('items', () => {
  it('appends to the end and trims', () => {
    const queue = queueOf('A', 'B');
    addItem(queue, { pipeline: 'feature', task: '  C  ', title: ' Вход ' }, 'q3', 5);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
    expect(queue.items[2]).toMatchObject({ task: 'C', groups: null, title: 'Вход', error: null });
  });

  it('takes groups instead of a task', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(
      queue,
      {
        pipeline: 'feature',
        groups: [
          { title: 'форма входа', task: 'x' },
          { title: 'форма регистрации', task: 'y' },
        ],
      },
      'q1',
      2,
    );
    expect(queue.items[0]).toMatchObject({ task: null });
    expect(queue.items[0]?.groups).toHaveLength(2);
  });

  it('requires exactly one of task and groups, and non-empty fields', () => {
    const queue = emptyQueue('/repo', 1);
    const fail = (fields: Parameters<typeof addItem>[1]) =>
      expect(() => addItem(queue, fields, 'q', 1)).toThrow();
    fail({ pipeline: 'feature' });
    fail({ pipeline: 'feature', task: 'x', groups: [{ title: 'a', task: 'b' }] });
    fail({ pipeline: 'feature', task: '  ' });
    fail({ pipeline: 'feature', groups: [] });
    fail({ pipeline: 'feature', groups: [{ title: ' ', task: 'b' }] });
    fail({ pipeline: 'feature', groups: [{ title: 'a', task: ' ' }] });
    fail({ pipeline: 'feature', task: 'x', title: '  ' });
    fail({ pipeline: 'feature', task: 'x', title: 'я'.repeat(61) });
    expect(() =>
      addItem(queue, { pipeline: 'feature', task: 'x', title: 'я'.repeat(60) }, 'q', 1),
    ).not.toThrow();
    expect(queue.items).toHaveLength(1);
  });

  it('moves an item and shifts the others', () => {
    const queue = queueOf('A', 'B', 'C');
    moveItem(queue, 'q3', 1, 9);
    expect(ids(queue)).toEqual(['q3', 'q1', 'q2']);
    moveItem(queue, 'q3', 3, 9);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
    expect(() => moveItem(queue, 'q1', 4, 9)).toThrow('position must be');
    expect(() => moveItem(queue, 'q1', 0, 9)).toThrow('position must be');
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
  });

  it('edits fields, switches between task and groups, moves, clears the error', () => {
    const queue = queueOf('A', 'B');
    queue.items[1]!.error = 'boom';
    editItem(queue, 'q2', { groups: [{ title: 'a', task: 'b' }], title: 'T', position: 1 }, 7);
    expect(ids(queue)).toEqual(['q2', 'q1']);
    expect(queue.items[0]).toMatchObject({ task: null, title: 'T', error: null });
    editItem(queue, 'q2', { task: 'снова', title: null }, 8);
    expect(queue.items[0]).toMatchObject({ task: 'снова', groups: null, title: null });
    expect(() =>
      editItem(queue, 'q2', { task: 'a', groups: [{ title: 'a', task: 'b' }] }, 9),
    ).toThrow();
  });

  it('does not change anything when an edit is refused', () => {
    const queue = queueOf('A', 'B');
    expect(() => editItem(queue, 'q1', { pipeline: 'other', task: ' ', position: 2 }, 9)).toThrow();
    expect(() => editItem(queue, 'q1', { pipeline: 'other', position: 5 }, 9)).toThrow();
    expect(queue.items[0]).toMatchObject({ pipeline: 'feature', task: 'A' });
    expect(ids(queue)).toEqual(['q1', 'q2']);
  });

  it('refuses an unknown item', () => {
    const queue = queueOf('A');
    expect(() => editItem(queue, 'nope', {}, 1)).toThrow('unknown queue item');
    expect(() => removeItem(queue, 'nope', 1)).toThrow('unknown queue item');
    expect(() => moveItem(queue, 'nope', 1, 1)).toThrow('unknown queue item');
    removeItem(queue, 'q1', 1);
    expect(queue.items).toEqual([]);
  });

  it('keeps parallel within 1 to 20', () => {
    const queue = emptyQueue('/repo', 1);
    setParallel(queue, 3, 2);
    expect(queue.parallel).toBe(3);
    for (const bad of [0, 21, 1.5, Number.NaN]) {
      expect(() => setParallel(queue, bad, 3)).toThrow('parallel must be');
    }
    setParallel(queue, QUEUE_PARALLEL_MAX, 4);
    expect(queue.parallel).toBe(20);
  });
});

describe('returned run patch', () => {
  it('rejects a change of the task and allows the place', () => {
    expect(() => checkReturnedPatch({ task: 'x' })).toThrow('a returned run keeps its own task');
    expect(() => checkReturnedPatch({ position: 1, after: [] })).not.toThrow();
  });
});

describe('task numbers', () => {
  const numbers = (queue: Queue) => queue.items.map((item) => item.number);

  it('gives the tasks the numbers 1, 2, 3 in the order they were added', () => {
    const queue = queueOf('A', 'B', 'C');
    expect(numbers(queue)).toEqual([1, 2, 3]);
    expect(queue.nextNumber).toBe(4);
  });

  it('starts from the given number', () => {
    const queue = emptyQueue('/repo', 1, 10);
    expect(addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2).number).toBe(10);
    expect(queue.nextNumber).toBe(11);
  });

  it('does not give a number of a removed task again', () => {
    const queue = queueOf('A', 'B', 'C');
    removeItem(queue, 'q3', 3);
    expect(addItem(queue, { pipeline: 'feature', task: 'D' }, 'q4', 4).number).toBe(4);
    expect(numbers(queue)).toEqual([1, 2, 4]);
  });

  it('does not spend a number on a refused task', () => {
    const queue = queueOf('A');
    expect(() => addItem(queue, { pipeline: 'feature', task: ' ' }, 'q2', 3)).toThrow();
    expect(() =>
      addItem(queue, { pipeline: 'feature', task: 'B', after: ['q2'] }, 'q2', 3),
    ).toThrow('a task cannot depend on itself');
    expect(queue.nextNumber).toBe(2);
    expect(addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3).number).toBe(2);
  });

  it('keeps the number when the task is moved, edited or postponed', () => {
    const queue = queueOf('A', 'B', 'C');
    moveItem(queue, 'q3', 1, 9);
    editItem(queue, 'q2', { task: 'changed', title: 'T', postponed: true }, 10);
    expect(queue.items.map((item) => [item.id, item.number])).toEqual([
      ['q3', 3],
      ['q1', 1],
      ['q2', 2],
    ]);
    expect(queue.nextNumber).toBe(4);
  });
});

describe('problems', () => {
  it('finds needs_human, failed and conflict with the attempt number in the key', () => {
    const state = run(3);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    step(state, 2000);
    expect(runProblems(state)).toEqual([
      {
        key: 'run000000001/gruppa-1/needs_human/1',
        run: 'run000000001',
        group: 'gruppa-1',
        reason: 'needs_human',
      },
    ]);
    group(state, 'gruppa-2').status = 'failed';
    group(state, 'gruppa-3').status = 'conflict';
    expect(runProblems(state).map((problem) => problem.reason)).toEqual([
      'needs_human',
      'failed',
      'conflict',
    ]);
  });

  it('reports a cancelled run once', () => {
    const state = run(1);
    transition(state, { kind: 'cancel', group: null }, 50);
    expect(runProblems(state)).toEqual([
      {
        key: 'run000000001/run/cancelled/0',
        run: 'run000000001',
        group: null,
        reason: 'cancelled',
      },
    ]);
  });

  it('keeps the problems of a run with failed and cancelled groups', () => {
    const state = run(2);
    group(state, 'gruppa-1').status = 'failed';
    group(state, 'gruppa-2').status = 'cancelled';
    expect(runPhase(state)).toBe('cancelled');
    expect(runProblems(state).map((problem) => problem.reason)).toEqual(['failed', 'cancelled']);
  });

  it('reports a failed delivery of a merged group', () => {
    const state = run(1);
    toMerging(state);
    merge(state);
    expect(runProblems(state)).toEqual([]);
    group(state).delivery = { ...group(state).delivery, state: 'apply_failed' };
    expect(runProblems(state).map((problem) => problem.reason)).toEqual(['apply_failed']);
  });

  it('drops the failed delivery of a group marked delivered by hand', () => {
    const state = run(1);
    state.run.config.delivery.auto = true;
    toMerging(state);
    merge(state);
    state.run.pendingDelivery = null;
    group(state).delivery = { ...group(state).delivery, state: 'apply_failed' };
    expect(runProblems(state).map((problem) => problem.reason)).toEqual(['apply_failed']);
    expect(runDone(state)).toBe(false);
    transition(state, { kind: 'delivered_marked', groups: null }, 6000);
    expect(runPhase(state)).toBe('finished');
    expect(runProblems(state)).toEqual([]);
    expect(runDone(state)).toBe(true);
    expect(occupiesSlot(state)).toBe(false);
    expect(
      dependencyState(queueOf('A'), state.run.id, (id) =>
        id === state.run.id ? state : undefined,
      ),
    ).toBe('done');
  });

  it('gives a repeated failure after a retry a new key', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    group(state).status = 'failed';
    const before = runProblems(state)[0]?.key;
    step(state);
    group(state).attempts.push({ ...group(state).attempts[0]! });
    group(state).status = 'failed';
    expect(runProblems(state)[0]?.key).not.toBe(before);
  });
});

describe('automatic delivery of an item', () => {
  it('is null by default and stores false and true', () => {
    const queue = emptyQueue('/repo', 1);
    expect(addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2).autoDeliver).toBeNull();
    expect(
      addItem(queue, { pipeline: 'feature', task: 'B', autoDeliver: false }, 'q2', 2).autoDeliver,
    ).toBe(false);
    expect(
      addItem(queue, { pipeline: 'feature', task: 'C', autoDeliver: true }, 'q3', 2).autoDeliver,
    ).toBe(true);
  });

  it('changes only when the patch names it, and null resets it', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', autoDeliver: false }, 'q1', 2);
    editItem(queue, 'q1', { title: 'Имя' }, 3);
    expect(queue.items[0]?.autoDeliver).toBe(false);
    editItem(queue, 'q1', { autoDeliver: true }, 4);
    expect(queue.items[0]?.autoDeliver).toBe(true);
    editItem(queue, 'q1', { autoDeliver: null }, 5);
    expect(queue.items[0]?.autoDeliver).toBeNull();
  });
});

describe('skip of an item', () => {
  it('is empty by default and collapses repeats', () => {
    const queue = emptyQueue('/repo', 1);
    expect(addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2).skip).toEqual([]);
    expect(
      addItem(queue, { pipeline: 'feature', task: 'B', skip: ['qa', 'review', 'qa'] }, 'q2', 2)
        .skip,
    ).toEqual(['qa', 'review']);
  });

  it('is replaced as a whole, cleared by [] and kept by other edits', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', skip: ['qa'] }, 'q1', 2);
    editItem(queue, 'q1', { title: 'Имя' }, 3);
    expect(queue.items[0]?.skip).toEqual(['qa']);
    editItem(queue, 'q1', { skip: ['review', 'qa'] }, 4);
    expect(queue.items[0]?.skip).toEqual(['review', 'qa']);
    editItem(queue, 'q1', { skip: [] }, 5);
    expect(queue.items[0]?.skip).toEqual([]);
  });
});

describe('place', () => {
  it('is held by an unfinished run', () => {
    expect(occupiesSlot(run(1))).toBe(true);
  });

  it('is held until the delivery ends with delivery.auto, and not without it', () => {
    for (const value of [true, false]) {
      const state = run(1);
      state.run.config.delivery.auto = value;
      toMerging(state);
      merge(state);
      expect(state.run.finishedAt).not.toBeNull();
      expect(occupiesSlot(state)).toBe(value);
      group(state).delivery = { ...group(state).delivery, state: 'applied' };
      state.run.pendingDelivery = null;
      expect(occupiesSlot(state)).toBe(false);
    }
  });

  it('is not held after the finish when the run overrides delivery.auto with false', () => {
    const state = run(1, { autoDeliver: false });
    toMerging(state);
    merge(state);
    expect(state.run.finishedAt).not.toBeNull();
    expect(occupiesSlot(state)).toBe(false);
  });

  it('is held while the delivery is pending when the run overrides delivery.auto with true', () => {
    const state = run(1, { autoDeliver: true });
    toMerging(state);
    merge(state);
    group(state).delivery = { ...group(state).delivery, state: 'pending' };
    expect(occupiesSlot(state)).toBe(true);
  });

  it('is held while a delivery is pending', () => {
    const state = run(1);
    state.run.config.delivery.auto = true;
    toMerging(state);
    merge(state);
    group(state).delivery = { ...group(state).delivery, state: 'applied' };
    state.run.pendingDelivery = { groups: ['gruppa-1'], force: false, auto: true };
    expect(occupiesSlot(state)).toBe(true);
  });
});

describe('start, pause, advance', () => {
  it('does not take anything while stopped', () => {
    const queue = queueOf('A', 'B');
    expect(advance(queue, [], none, 5).take).toEqual([]);
    expect(queue.status).toBe('stopped');
  });

  it('takes one item with parallel 1 and the next only after the place is free', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    expect(advance(queue, [], none, 4).take.map((item) => item.id)).toEqual(['q1']);
    const first = run(1, { id: 'r1' });
    itemStarted(queue, 'q1', 'r1', 5);
    taken(queue, first);
    queue.runs = ['r1'];
    expect(advance(queue, [first], none, 6).take).toEqual([]);
    first.run.config.delivery.auto = false;
    toMerging(first);
    merge(first);
    expect(advance(queue, [first], none, 7).take.map((item) => item.id)).toEqual(['q2']);
    expect(queue.runs).toEqual([]);
  });

  it('takes two items with parallel 2 and a third when a place frees up', () => {
    const queue = queueOf('A', 'B', 'C');
    setParallel(queue, 2, 1);
    startQueue(queue, [], 3);
    expect(advance(queue, [], none, 4).take.map((item) => item.id)).toEqual(['q1', 'q2']);
    const a = run(1, { id: 'a' });
    const b = run(1, { id: 'b' });
    itemStarted(queue, 'q1', 'a', 5);
    itemStarted(queue, 'q2', 'b', 5);
    expect(advance(queue, [a, b], none, 6).take).toEqual([]);
    a.run.config.delivery.auto = false;
    toMerging(a);
    merge(a);
    expect(advance(queue, [a, b], none, 7).take.map((item) => item.id)).toEqual(['q3']);
  });

  it('lowering parallel does not release runs but holds new ones back', () => {
    const queue = queueOf('A', 'B', 'C');
    setParallel(queue, 2, 1);
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 5);
    itemStarted(queue, 'q2', 'b', 5);
    setParallel(queue, 1, 6);
    expect(advance(queue, [run(1, { id: 'a' }), run(1, { id: 'b' })], none, 7).take).toEqual([]);
    expect(queue.runs).toEqual(['a', 'b']);
  });

  it('pause stops taking and keeps runs', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    pauseQueue(queue, 5);
    expect(advance(queue, [run(1, { id: 'a' })], none, 6).take).toEqual([]);
    expect(queue.status).toBe('stopped');
    expect(queue.runs).toEqual(['a']);
  });

  it('stops itself when it is empty and nothing holds a place', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    advance(queue, [], none, 4);
    itemStarted(queue, 'q1', 'a', 5);
    const state = run(1, { id: 'a' });
    state.run.config.delivery.auto = false;
    advance(queue, [state], none, 6);
    expect(queue.status).toBe('running');
    toMerging(state);
    merge(state);
    advance(queue, [state], none, 7);
    expect(queue.status).toBe('stopped');
    expect(queue.runs).toEqual([]);
  });

  it('stops on a new failed or conflict problem and keeps the run, group and reason', () => {
    for (const reason of ['failed', 'conflict'] as const) {
      const queue = queueOf('A', 'B');
      startQueue(queue, [], 3);
      itemStarted(queue, 'q1', 'a', 4);
      const state = run(1, { id: 'a' });
      step(state);
      group(state).status = reason;
      advance(queue, [state], none, 5);
      expect(queue).toMatchObject({
        status: 'stopped',
        stop: { kind: 'problem', run: 'a', group: 'gruppa-1', reason },
      });
      expect(advance(queue, [state], none, 6).take).toEqual([]);
      expect(queue.runs).toEqual(['a']);
    }
  });

  it('does not stop on a question to a human and keeps the place', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    expect(advance(queue, [state], none, 5).take).toEqual([]);
    expect(queue).toMatchObject({ status: 'running', stop: null, runs: ['a'] });
  });

  it('takes the next item with parallel 2 while one run waits for a human', () => {
    const queue = queueOf('A', 'B');
    setParallel(queue, 2, 2);
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    expect(advance(queue, [state], none, 5).take.map((item) => item.id)).toEqual(['q2']);
    expect(queue).toMatchObject({ status: 'running', stop: null });
  });

  it('does not stop when a retried group ends up asking a human', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    group(state).status = 'failed';
    advance(queue, [state], none, 5);
    startQueue(queue, [state], 6);
    group(state).attempts.push({ ...group(state).attempts[0]!, seq: 2 });
    group(state).status = 'needs_human';
    advance(queue, [state], none, 7);
    expect(queue).toMatchObject({ status: 'running', stop: null });
  });

  it('continues after a failed run: the problem is known after the start', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    group(state).status = 'failed';
    advance(queue, [state], none, 5);
    startQueue(queue, [state], 6);
    expect(queue).toMatchObject({ status: 'running', stop: null });
    expect(advance(queue, [state], none, 7).take).toEqual([]);
    expect(queue.status).toBe('running');
  });

  it('takes the next task after a failed run when the queue is started again', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    finish(state, 'done');
    group(state).status = 'failed';
    state.run.finishedAt = 100;
    advance(queue, [state], none, 5);
    expect(queue.stop).toMatchObject({ reason: 'failed' });
    expect(queue.runs).toEqual([]);
    startQueue(queue, [state], 6);
    expect(advance(queue, [state], none, 7).take.map((item) => item.id)).toEqual(['q2']);
    expect(queue.stop).toBeNull();
  });

  it('stops again on another group of the same run', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(2, { id: 'a' });
    step(state);
    group(state).status = 'failed';
    advance(queue, [state], none, 5);
    startQueue(queue, [state], 6);
    advance(queue, [state], none, 7);
    expect(queue.status).toBe('running');
    group(state, 'gruppa-2').status = 'conflict';
    advance(queue, [state], none, 8);
    expect(queue.stop).toMatchObject({ reason: 'conflict', group: 'gruppa-2' });
  });

  it('stops again when a retried group fails again', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(2, { id: 'a' });
    step(state);
    group(state).status = 'failed';
    advance(queue, [state], none, 5);
    expect(queue.stop).toMatchObject({ reason: 'failed', group: 'gruppa-1' });
    startQueue(queue, [state], 6);
    // retry: another attempt, the group fails again; the queue did not see the state in between
    group(state).attempts.push({ ...group(state).attempts[0]!, seq: 2 });
    group(state).status = 'failed';
    advance(queue, [state], none, 7);
    expect(queue).toMatchObject({
      status: 'stopped',
      stop: { reason: 'failed', group: 'gruppa-1' },
    });
  });

  it('keeps a run waiting for its delivery after the pause of an empty queue', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    state.run.config.delivery.auto = true;
    toMerging(state);
    merge(state);
    pauseQueue(queue, 5);
    advance(queue, [state], none, 6);
    expect(queue.status).toBe('stopped');
    expect(queue.runs).toEqual(['a']);
    expect(state.run.pendingDelivery).not.toBeNull();
    group(state).delivery = { ...group(state).delivery, state: 'apply_failed' };
    advance(queue, [state], none, 7);
    expect(queue.stop).toMatchObject({ kind: 'problem', reason: 'apply_failed' });
    expect(queue.runs).toEqual(['a']);
    state.run.pendingDelivery = null;
    advance(queue, [state], none, 8);
    expect(queue.runs).toEqual([]);
  });

  it('forgets the known problems of a run that left', () => {
    const queue = queueOf('A');
    queue.acknowledged = ['a/x/failed/1', 'b/x/failed/1'];
    queue.runs = ['a'];
    const state = run(1, { id: 'a' });
    state.run.finishedAt = 5;
    advance(queue, [state], none, 6);
    expect(queue.acknowledged).toEqual(['b/x/failed/1']);
  });

  it('keeps an item first with its error when it cannot start', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemFailed(queue, 'q1', 'unknown pipeline `feature`; known: none', 4);
    expect(queue).toMatchObject({
      status: 'stopped',
      stop: { kind: 'item', item: 'q1' },
    });
    expect(ids(queue)).toEqual(['q1', 'q2']);
    expect(queue.items[0]?.error).toContain('unknown pipeline');
    expect(advance(queue, [], none, 5).take).toEqual([]);
    startQueue(queue, [], 6);
    expect(queue.items[0]?.error).toBeNull();
    expect(queue.stop).toBeNull();
  });
});

describe('run origin', () => {
  it('marks a run created by the queue', () => {
    const state = createRun({
      id: 'r',
      number: 1,
      repository: '/repo',
      pipeline: 'feature',
      baseCommit: 'c',
      config: config(),
      dirtyWarning: false,
      groups: [{ title: 'a', task: 'b' }],
      split: false,
      now: 1,
      fromQueue: true,
    });
    expect(state.run.fromQueue).toBe(true);
    expect(run(1).run.fromQueue).toBe(false);
  });
});

describe('tags of items', () => {
  it('adds an item with tags, without duplicates, and without tags by default', () => {
    const queue = emptyQueue('/repo', 1);
    const tagged = addItem(
      queue,
      { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b', 'tg-a'] },
      'q1',
      2,
    );
    expect(tagged.tags).toEqual(['tg-a', 'tg-b']);
    expect(addItem(queue, { pipeline: 'feature', task: 'y' }, 'q2', 2).tags).toEqual([]);
  });

  it('replaces the tags on edit only when they are passed', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 2);
    editItem(queue, 'q1', { task: 'new' }, 3);
    expect(queue.items[0]?.tags).toEqual(['tg-a', 'tg-b']);
    editItem(queue, 'q1', { tags: ['tg-b'] }, 4);
    expect(queue.items[0]?.tags).toEqual(['tg-b']);
    editItem(queue, 'q1', { tags: [] }, 5);
    expect(queue.items[0]?.tags).toEqual([]);
  });

  it('puts the tags into a created run', () => {
    expect(createRun({ ...runInput(), tags: ['tg-a'] }).run.tags).toEqual(['tg-a']);
    expect(run(1).run.tags).toEqual([]);
  });
});

function runInput() {
  const state = run(1);
  return {
    id: 'run000000009',
    number: 1,
    repository: '/repo',
    pipeline: 'feature',
    baseCommit: 'abc',
    config: state.run.config,
    dirtyWarning: false,
    groups: [{ title: 'G', task: 't' }],
    split: false,
    now: 1,
  };
}

/** A run that is merged; `applied` marks its group as delivered to the working tree. */
function mergedRun(id: string, applied: boolean): RunState {
  const state = run(1, { id });
  state.run.config.delivery.auto = false;
  toMerging(state);
  merge(state);
  if (applied) group(state).delivery = { ...group(state).delivery, state: 'applied' };
  return state;
}

function failedRun(id: string): RunState {
  const state = run(1, { id });
  step(state);
  group(state).status = 'failed';
  return state;
}

const lookupOf =
  (...states: RunState[]) =>
  (id: string): RunState | undefined =>
    states.find((state) => state.run.id === id);

function withAfter(queue: Queue, id: string, after: string[]): void {
  editItem(queue, id, { after }, 3);
}

describe('dependencies', () => {
  it('stores after on add, collapses duplicates and checks the edit', () => {
    const queue = queueOf('A');
    const item = addItem(
      queue,
      { pipeline: 'feature', task: 'B', after: ['q1', 'q1', 'r9'] },
      'q2',
      3,
    );
    expect(item.after).toEqual(['q1', 'r9']);
    editItem(queue, 'q2', { title: 'T' }, 4);
    expect(item.after).toEqual(['q1', 'r9']);
    editItem(queue, 'q2', { after: ['q1'] }, 5);
    expect(item.after).toEqual(['q1']);
    editItem(queue, 'q2', { after: [] }, 6);
    expect(item.after).toEqual([]);
  });

  it('rejects a reference to itself and cycles, leaving the queue unchanged', () => {
    const queue = queueOf('A', 'B', 'C');
    expect(() => editItem(queue, 'q1', { after: ['q1'] }, 4)).toThrow(
      'a task cannot depend on itself',
    );
    expect(() =>
      addItem(queue, { pipeline: 'feature', task: 'X', after: ['q4'] }, 'q4', 4),
    ).toThrow('a task cannot depend on itself');
    expect(queue.items).toHaveLength(3);
    withAfter(queue, 'q2', ['q1']);
    expect(() => editItem(queue, 'q1', { after: ['q2'] }, 4)).toThrow(
      'dependency cycle: q1 → q2 → q1',
    );
    withAfter(queue, 'q3', ['q2']);
    expect(() => editItem(queue, 'q1', { after: ['q3'], title: 'x' }, 4)).toThrow(
      'dependency cycle: q1 → q3 → q2 → q1',
    );
    expect(queue.items[0]!.after).toEqual([]);
    expect(queue.items[0]!.title).toBeNull();
  });

  it('points the successors at the run when the item starts', () => {
    const queue = queueOf('A', 'B', 'C');
    withAfter(queue, 'q2', ['q1']);
    withAfter(queue, 'q3', ['q1', 'r1']);
    itemStarted(queue, 'q1', 'r1', 5);
    expect(queue.items.map((item) => item.after)).toEqual([['r1'], ['r1']]);
  });

  it('drops the reference when the predecessor is removed', () => {
    const queue = queueOf('A', 'B');
    withAfter(queue, 'q2', ['q1']);
    removeItem(queue, 'q1', 5);
    expect(queue.items[0]!.after).toEqual([]);
  });

  it('reports the state of a run dependency', () => {
    const queue = queueOf('A');
    const applied = mergedRun('r1', true);
    const notApplied = mergedRun('r2', false);
    const failed = failedRun('r3');
    const working = run(1, { id: 'r4' });
    const asked = run(1, { id: 'r5' });
    step(asked);
    finish(asked, 'needs_human', { feedback: 'q' });
    const lookup = lookupOf(applied, notApplied, failed, working, asked);
    expect(dependencyState(queue, 'r1', lookup)).toBe('done');
    expect(dependencyState(queue, 'r2', lookup)).toBe('waiting');
    expect(dependencyState(queue, 'r3', lookup)).toBe('blocked');
    expect(dependencyState(queue, 'r4', lookup)).toBe('waiting');
    expect(dependencyState(queue, 'r5', lookup)).toBe('waiting');
    expect(dependencyState(queue, 'gone', lookup)).toBe('blocked');
  });

  it('does not call a finished run without groups done', () => {
    const queue = queueOf('A');
    const state = mergedRun('r1', true);
    expect(dependencyState(queue, 'r1', lookupOf(state))).toBe('done');
    state.groups = [];
    expect(dependencyState(queue, 'r1', lookupOf(state))).toBe('waiting');
  });

  it('treats a cycle in stored data as waiting', () => {
    const queue = queueOf('A', 'B', 'C');
    queue.items[0]!.after = ['q2'];
    queue.items[1]!.after = ['q1'];
    const [a, b] = queue.items as [QueueItem, QueueItem];
    expect(itemReadiness(queue, a, none)).toBe('waiting');
    expect(itemReadiness(queue, b, none)).toBe('waiting');
    startQueue(queue, [], 3);
    expect(advance(queue, [], none, 4).take.map((item) => item.id)).toEqual(['q3']);
  });

  it('derives the readiness of an item through a chain of items', () => {
    const queue = queueOf('A', 'B', 'C');
    withAfter(queue, 'q2', ['q1']);
    withAfter(queue, 'q3', ['q2']);
    withAfter(queue, 'q1', ['r1']);
    const [a, b, c] = queue.items as [QueueItem, QueueItem, QueueItem];
    expect(itemReadiness(queue, a, lookupOf(mergedRun('r1', true)))).toBe('ready');
    expect(itemReadiness(queue, a, lookupOf(mergedRun('r1', false)))).toBe('waiting');
    expect(itemReadiness(queue, b, lookupOf(mergedRun('r1', true)))).toBe('waiting');
    expect(itemReadiness(queue, c, lookupOf(failedRun('r1')))).toBe('blocked');
    expect(itemReadiness(queue, b, none)).toBe('blocked');
  });

  it('lets a ready item overtake a waiting one', () => {
    const queue = queueOf('A', 'B', 'C');
    setParallel(queue, 2, 1);
    withAfter(queue, 'q2', ['q1']);
    startQueue(queue, [], 3);
    expect(advance(queue, [], none, 4).take.map((item) => item.id)).toEqual(['q1', 'q3']);
  });

  it('keeps the queue running when only waiting items are left', () => {
    const queue = queueOf('A');
    withAfter(queue, 'q1', ['r1']);
    startQueue(queue, [], 3);
    const working = run(1, { id: 'r1' });
    expect(advance(queue, [], lookupOf(working), 4).take).toEqual([]);
    expect(queue.status).toBe('running');
  });

  it('takes the waiting item once its predecessor is delivered, with a larger parallel too', () => {
    const queue = queueOf('A');
    setParallel(queue, 3, 1);
    withAfter(queue, 'q1', ['r1']);
    startQueue(queue, [], 3);
    expect(advance(queue, [], lookupOf(mergedRun('r1', false)), 4).take).toEqual([]);
    expect(
      advance(queue, [], lookupOf(mergedRun('r1', true)), 5).take.map((item) => item.id),
    ).toEqual(['q1']);
  });
});

describe('queue settings', () => {
  it('changes only the passed fields', () => {
    const queue = emptyQueue('/repo', 1);
    setParallel(queue, 2, 2);
    setQueueSettings(queue, { skipFailed: true }, 3);
    expect(queue).toMatchObject({ parallel: 2, autopilot: false, skipFailed: true, updatedAt: 3 });
    setQueueSettings(queue, { autopilot: true, parallel: 4 }, 4);
    expect(queue).toMatchObject({ parallel: 4, autopilot: true, skipFailed: true });
  });

  it('refuses an empty patch and a wrong parallel without a change', () => {
    const queue = emptyQueue('/repo', 1);
    expect(() => setQueueSettings(queue, {}, 2)).toThrow(
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed or onLimit',
    );
    expect(() => setQueueSettings(queue, { parallel: 0, autopilot: true }, 2)).toThrow(
      /parallel must be/,
    );
    expect(queue).toMatchObject({ parallel: 1, autopilot: false, updatedAt: 1 });
  });

  it('turns auto answer on without touching autopilot or the state', () => {
    const queue = emptyQueue('/repo', 1);
    setQueueSettings(queue, { autoAnswer: true }, 2);
    expect(queue).toMatchObject({ autoAnswer: true, autopilot: false, status: 'stopped' });
    setQueueSettings(queue, { autoAnswer: false }, 3);
    expect(queue.autoAnswer).toBe(false);
  });

  it('starts a new queue with both modes off and nothing skipped', () => {
    expect(emptyQueue('/repo', 1)).toMatchObject({
      autopilot: false,
      autoAnswer: false,
      skipFailed: false,
      skipped: [],
    });
  });
});

describe('autopilot', () => {
  it('keeps an empty running queue running and takes a task added later', () => {
    const queue = queueOf('A');
    queue.autopilot = true;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    state.run.config.delivery.auto = false;
    toMerging(state);
    merge(state);
    expect(advance(queue, [state], none, 5).take).toEqual([]);
    expect(queue).toMatchObject({ status: 'running', runs: [] });
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 6);
    expect(advance(queue, [], none, 7).take.map((item) => item.id)).toEqual(['q2']);
  });

  it('stops an empty queue on the next step after it is turned off', () => {
    const queue = emptyQueue('/repo', 1);
    queue.autopilot = true;
    startQueue(queue, [], 2);
    advance(queue, [], none, 3);
    expect(queue.status).toBe('running');
    setQueueSettings(queue, { autopilot: false }, 4);
    expect(queue.status).toBe('running');
    advance(queue, [], none, 5);
    expect(queue.status).toBe('stopped');
  });

  it('stays paused after a pause and does not take tasks', () => {
    const queue = emptyQueue('/repo', 1);
    queue.autopilot = true;
    startQueue(queue, [], 2);
    pauseQueue(queue, 3);
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 4);
    expect(advance(queue, [], none, 5).take).toEqual([]);
    expect(queue.status).toBe('stopped');
  });

  it('does not change the stop reason when it is turned on', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    advance(queue, [state], none, 5);
    setQueueSettings(queue, { autopilot: true }, 6);
    advance(queue, [state], none, 7);
    expect(queue).toMatchObject({ status: 'stopped', stop: { reason: 'failed' } });
  });
});

describe('skip failed', () => {
  function started(...tasks: string[]): Queue {
    const queue = queueOf(...tasks);
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    return queue;
  }

  it('moves a failed run to skipped and takes the next task', () => {
    const queue = started('A', 'B');
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    const take = advance(queue, [state], lookupOf(state), 5).take;
    expect(take.map((item) => item.id)).toEqual(['q2']);
    expect(queue).toMatchObject({ status: 'running', stop: null, runs: [], skipped: ['a'] });
  });

  it('skips on a conflict as well', () => {
    const queue = started('A', 'B');
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    group(state).status = 'conflict';
    advance(queue, [state], lookupOf(state), 5);
    expect(queue).toMatchObject({ status: 'running', stop: null, skipped: ['a'] });
  });

  it('skips a run with a known problem when the mode is turned on', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    startQueue(queue, [state], 5);
    expect(queue.acknowledged.length).toBe(1);
    setQueueSettings(queue, { skipFailed: true }, 6);
    const take = advance(queue, [state], lookupOf(state), 7).take;
    expect(take.map((item) => item.id)).toEqual(['q2']);
    expect(queue).toMatchObject({ runs: [], skipped: ['a'], acknowledged: [] });
  });

  it('does not touch a stopped queue state when it is turned on', () => {
    const queue = queueOf('A', 'B');
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    advance(queue, [state], lookupOf(state), 5);
    setQueueSettings(queue, { skipFailed: true }, 6);
    expect(queue).toMatchObject({ status: 'stopped', stop: { reason: 'failed' } });
  });

  it('does not put a question to a human into skipped', () => {
    const queue = started('A', 'B');
    itemStarted(queue, 'q1', 'a', 4);
    const state = run(1, { id: 'a' });
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    expect(advance(queue, [state], lookupOf(state), 5).take).toEqual([]);
    expect(queue).toMatchObject({ runs: ['a'], skipped: [] });
  });

  it('removes a skipped run when its problem is gone or the run does not exist', () => {
    const queue = started('A');
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    advance(queue, [state], lookupOf(state), 5);
    expect(queue.skipped).toEqual(['a']);
    group(state).status = 'running';
    advance(queue, [], lookupOf(state), 6);
    expect(queue.skipped).toEqual([]);
    queue.skipped = ['gone'];
    advance(queue, [], none, 7);
    expect(queue.skipped).toEqual([]);
  });

  it('keeps a skipped run out of the places after the mode is turned off', () => {
    const queue = started('A');
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    advance(queue, [state], lookupOf(state), 5);
    setQueueSettings(queue, { skipFailed: false }, 6);
    advance(queue, [state], lookupOf(state), 7);
    expect(queue).toMatchObject({ runs: [], skipped: ['a'], stop: null });
  });

  it('keeps at most ten, dropping the earliest', () => {
    const queue = started();
    const states: RunState[] = [];
    for (let index = 1; index <= 11; index += 1) {
      const state = failedRun(`r${index}`);
      states.push(state);
      queue.runs.push(state.run.id);
      advance(queue, states, lookupOf(...states), 5 + index);
    }
    expect(queue.skipped).toHaveLength(10);
    expect(queue.skipped[0]).toBe('r11');
    expect(queue.skipped).not.toContain('r1');
  });

  it('blocks a task that waits for a skipped run and takes the others', () => {
    const queue = started('A', 'B', 'C');
    itemStarted(queue, 'q1', 'a', 4);
    withAfter(queue, 'q2', ['a']);
    const state = failedRun('a');
    const lookup = lookupOf(state);
    const take = advance(queue, [state], lookup, 5).take;
    expect(take.map((item) => item.id)).toEqual(['q3']);
    expect(itemReadiness(queue, queue.items[0]!, lookup)).toBe('blocked');
    expect(queue.status).toBe('running');
  });

  it('keeps the item with an error and the running state when a start fails', () => {
    const queue = started('A', 'B');
    itemFailed(queue, 'q1', 'unknown pipeline `feature`', 5);
    expect(queue).toMatchObject({ status: 'running', stop: null });
    expect(queue.items[0]).toMatchObject({ id: 'q1', error: 'unknown pipeline `feature`' });
    expect(advance(queue, [], none, 6).take.map((item) => item.id)).toEqual(['q2']);
  });

  it('takes an item with an error again after a start or an edit', () => {
    const queue = started('A');
    itemFailed(queue, 'q1', 'boom', 5);
    expect(advance(queue, [], none, 6).take).toEqual([]);
    startQueue(queue, [], 7);
    expect(advance(queue, [], none, 8).take.map((item) => item.id)).toEqual(['q1']);
  });

  it('stops on a failed start when the mode is off', () => {
    const queue = queueOf('A');
    startQueue(queue, [], 3);
    itemFailed(queue, 'q1', 'boom', 5);
    expect(queue).toMatchObject({ status: 'stopped', stop: { kind: 'item', item: 'q1' } });
  });
});

describe('tags along dependencies', () => {
  function tagged(): Queue {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', tags: ['tg-a'] }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'b', after: ['q1'] }, 'q2', 2);
    addItem(queue, { pipeline: 'feature', task: 'c', after: ['q2'] }, 'q3', 2);
    addItem(queue, { pipeline: 'feature', task: 'd' }, 'q4', 2);
    return queue;
  }

  it('dependencyTags takes the tags of items and runs in the order of references', () => {
    const queue = tagged();
    addItem(queue, { pipeline: 'feature', task: 'e', tags: ['tg-b', 'tg-a'] }, 'q5', 2);
    const runTags = (id: string) => (id === 'r1' ? ['tg-c', 'tg-b'] : undefined);
    expect(dependencyTags(queue, ['q5', 'r1', 'q1', 'r-unknown'], runTags)).toEqual([
      'tg-b',
      'tg-a',
      'tg-c',
    ]);
    expect(dependencyTags(queue, [], runTags)).toEqual([]);
    expect(dependencyTags(queue, ['r-unknown'], runTags)).toEqual([]);
  });

  it('spreadTags appends to a direct dependent and along a chain, not to an independent item', () => {
    const queue = tagged();
    expect(spreadTags(queue, 'q1', ['tg-x'], 9)).toEqual(['q2', 'q3']);
    expect(queue.items.map((item) => item.tags)).toEqual([['tg-a'], ['tg-x'], ['tg-x'], []]);
    expect(queue.updatedAt).toBe(9);
  });

  it('spreadTags works from a run id and skips items that already have the tag', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', after: ['r1'], tags: ['tg-x'] }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'b', after: ['q1'] }, 'q2', 2);
    expect(spreadTags(queue, 'r1', ['tg-x'], 9)).toEqual(['q2']);
    expect(queue.items[1]?.tags).toEqual(['tg-x']);
  });

  it('spreadTags changes nothing for empty tags and leaves updatedAt alone', () => {
    const queue = tagged();
    expect(spreadTags(queue, 'q1', [], 9)).toEqual([]);
    expect(spreadTags(queue, 'q4', ['tg-x'], 9)).toEqual([]);
    expect(queue.updatedAt).toBe(2);
  });

  it('spreadTags does not loop on a cycle in the data', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'b', after: ['q1'] }, 'q2', 2);
    queue.items[0]!.after = ['q2'];
    expect(spreadTags(queue, 'q1', ['tg-x'], 9).sort()).toEqual(['q2']);
    expect(queue.items[0]?.tags).toEqual([]);
  });
});

describe('delivery mode of an item', () => {
  it('is null by default and stores a mode', () => {
    const queue = emptyQueue('/repo', 1);
    expect(addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2).deliveryMode).toBeNull();
    expect(
      addItem(queue, { pipeline: 'feature', task: 'B', deliveryMode: 'commit' }, 'q2', 2)
        .deliveryMode,
    ).toBe('commit');
  });

  it('changes only when the patch names it, and null resets it', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', deliveryMode: 'branch' }, 'q1', 2);
    editItem(queue, 'q1', { title: 'Имя' }, 3);
    expect(queue.items[0]?.deliveryMode).toBe('branch');
    editItem(queue, 'q1', { deliveryMode: 'commit' }, 4);
    expect(queue.items[0]?.deliveryMode).toBe('commit');
    editItem(queue, 'q1', { deliveryMode: null }, 5);
    expect(queue.items[0]?.deliveryMode).toBeNull();
  });

  it('refuses an unknown mode', () => {
    const queue = emptyQueue('/repo', 1);
    expect(() =>
      addItem(queue, { pipeline: 'feature', task: 'A', deliveryMode: 'x' as never }, 'q1', 2),
    ).toThrow('delivery mode must be one of');
  });
});

describe('autopilot answer text', () => {
  it('is null by default, trimmed when set, and null restores the default', () => {
    const queue = emptyQueue('/repo', 1);
    expect(queue.autopilotAnswer).toBeNull();
    setQueueSettings(queue, { autopilotAnswer: '  Да, согласен  ' }, 2);
    expect(queue.autopilotAnswer).toBe('Да, согласен');
    setQueueSettings(queue, { autopilotAnswer: null }, 3);
    expect(queue.autopilotAnswer).toBeNull();
  });

  it('refuses an empty and a too long text without a change', () => {
    const queue = emptyQueue('/repo', 1);
    expect(() => setQueueSettings(queue, { autopilotAnswer: '  ' }, 2)).toThrow(
      'autopilot answer must not be empty',
    );
    expect(() => setQueueSettings(queue, { autopilotAnswer: 'x'.repeat(2001) }, 2)).toThrow(
      'autopilot answer must be at most 2000 characters',
    );
    expect(queue.updatedAt).toBe(1);
  });
});

describe('answers of the autopilot', () => {
  function asking(id = 'a'): RunState {
    const state = run(1, { id });
    step(state);
    finish(state, 'needs_human', { feedback: 'Какой вариант?' });
    return state;
  }

  function running(autoAnswer = true, autopilot = false): Queue {
    const queue = queueOf('A');
    queue.autoAnswer = autoAnswer;
    queue.autopilot = autopilot;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    return queue;
  }

  it('answers a question of a specialist with the default text', () => {
    const queue = running();
    const state = asking();
    expect(autopilotAnswers(queue, [state])).toEqual([
      { run: 'a', group: 'gruppa-1', answer: DEFAULT_AUTOPILOT_ANSWER },
    ]);
  });

  it('uses the text of the queue', () => {
    const queue = running();
    queue.autopilotAnswer = 'Согласен';
    expect(autopilotAnswers(queue, [asking()])[0]?.answer).toBe('Согласен');
  });

  it('answers with auto answer on and autopilot off', () => {
    expect(autopilotAnswers(running(true, false), [asking()])).toHaveLength(1);
  });

  it('does not answer with auto answer off even when autopilot is on', () => {
    expect(autopilotAnswers(running(false, true), [asking()])).toEqual([]);
  });

  it('does nothing with auto answer off or the queue paused', () => {
    expect(autopilotAnswers(running(false), [asking()])).toEqual([]);
    const queue = running();
    pauseQueue(queue, 5);
    expect(autopilotAnswers(queue, [asking()])).toEqual([]);
  });

  it('does not answer a rejection without a way back, a run outside the queue or a working group', () => {
    const queue = running();
    const rejected = run(1, { id: 'a' });
    step(rejected);
    finish(rejected, 'rejected', { feedback: 'нет' });
    expect(group(rejected).status).toBe('needs_human');
    expect(autopilotAnswers(queue, [rejected])).toEqual([]);
    expect(autopilotAnswers(queue, [asking('other')])).toEqual([]);
    const working = run(1, { id: 'a' });
    step(working);
    expect(autopilotAnswers(queue, [working])).toEqual([]);
  });

  it('does not answer a stop for changes outside the worktree', () => {
    const queue = running();
    const state = asking();
    group(state).attempts.at(-1)!.outsideChanges = ['/etc/hosts'];
    expect(autopilotAnswers(queue, [state])).toEqual([]);
  });

  it('answers at most three times in a row, and a human answer resets the count', () => {
    const queue = running();
    const state = asking();
    const decisions = group(state).decisions;
    const decision = (by: 'human' | 'autopilot') => ({
      stepId: 'code',
      question: 'q',
      answer: 'a',
      by,
    });
    decisions.push(decision('autopilot'), decision('autopilot'));
    expect(autopilotAnswers(queue, [state])).toHaveLength(1);
    decisions.push(decision('autopilot'));
    expect(autopilotAnswers(queue, [state])).toEqual([]);
    decisions.push(decision('human'));
    expect(autopilotAnswers(queue, [state])).toHaveLength(1);
  });

  it('records who answered', () => {
    const state = asking();
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'ok', by: 'autopilot' }, 5);
    expect(group(state).decisions[0]?.by).toBe('autopilot');
    const other = asking('b');
    transition(other, { kind: 'answer', group: 'gruppa-1', answer: 'ok' }, 5);
    expect(group(other).decisions[0]?.by).toBe('human');
  });
});

describe('fixed runs go first', () => {
  it('returns a skipped run that works again to the end of the places, over the parallel limit', () => {
    const queue = queueOf('A', 'B', 'C');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const failed = failedRun('a');
    expect(advance(queue, [failed], lookupOf(failed), 5).take.map((item) => item.id)).toEqual([
      'q2',
    ]);
    itemStarted(queue, 'q2', 'b', 6);
    expect(queue).toMatchObject({ runs: ['b'], skipped: ['a'] });
    group(failed).status = 'running';
    const other = run(1, { id: 'b' });
    step(other);
    const take = advance(queue, [other], lookupOf(failed, other), 7).take;
    expect(take).toEqual([]);
    expect(queue).toMatchObject({ runs: ['b', 'a'], skipped: [] });
  });

  it('only forgets a skipped run that no longer holds a place', () => {
    const queue = queueOf('A');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', 'a', 4);
    const state = failedRun('a');
    advance(queue, [state], lookupOf(state), 5);
    state.run.finishedAt = 100;
    state.run.config.delivery.auto = false;
    group(state).status = 'merged';
    group(state).delivery.state = 'applied';
    advance(queue, [], lookupOf(state), 6);
    expect(queue).toMatchObject({ runs: [], skipped: [] });
  });

  it('puts an item with an error first after an edit, unless a position is given', () => {
    const queue = queueOf('A', 'B', 'C');
    itemFailed(queue, 'q3', 'boom', 5);
    editItem(queue, 'q3', { title: 'Имя' }, 6);
    expect(ids(queue)).toEqual(['q3', 'q1', 'q2']);
    itemFailed(queue, 'q3', 'boom', 7);
    editItem(queue, 'q3', { position: 3 }, 8);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
    editItem(queue, 'q3', { title: 'Ещё' }, 9);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
  });
});

describe('postponed items', () => {
  it('is false by default, set by add and edit, and keeps position and order', () => {
    const queue = queueOf('A', 'B');
    expect(queue.items.every((item) => !item.postponed)).toBe(true);
    addItem(queue, { pipeline: 'feature', task: 'C', postponed: true }, 'q3', 3);
    expect(queue.items[2]!.postponed).toBe(true);
    editItem(queue, 'q1', { postponed: true }, 4);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
    expect(queue.items[0]).toMatchObject({ postponed: true, after: [] });
    editItem(queue, 'q1', { title: 'T' }, 5);
    expect(queue.items[0]!.postponed).toBe(true);
    editItem(queue, 'q1', { postponed: false }, 6);
    expect(queue.items[0]!.postponed).toBe(false);
  });

  it('is skipped by a running queue, which takes the next item', () => {
    const queue = queueOf('A', 'B');
    editItem(queue, 'q1', { postponed: true }, 3);
    startQueue(queue, [], 4);
    expect(advance(queue, [], none, 5).take.map((item) => item.id)).toEqual(['q2']);
  });

  it('is taken as soon as the flag is cleared; starting the queue keeps the flag', () => {
    const queue = queueOf('A');
    queue.autopilot = true;
    editItem(queue, 'q1', { postponed: true }, 3);
    startQueue(queue, [], 4);
    expect(queue.items[0]!.postponed).toBe(true);
    expect(advance(queue, [], none, 5).take).toEqual([]);
    editItem(queue, 'q1', { postponed: false }, 6);
    expect(advance(queue, [], none, 7).take.map((item) => item.id)).toEqual(['q1']);
  });

  it('leaves dependants waiting and does not change readiness', () => {
    const queue = queueOf('A');
    addItem(queue, { pipeline: 'feature', task: 'B', after: ['q1'] }, 'q2', 3);
    editItem(queue, 'q1', { postponed: true }, 4);
    startQueue(queue, [], 5);
    expect(itemReadiness(queue, queue.items[0]!, none)).toBe('ready');
    expect(itemReadiness(queue, queue.items[1]!, none)).toBe('waiting');
    expect(advance(queue, [], none, 6).take).toEqual([]);
  });

  it('stays blocked after a failed run and is not taken', () => {
    const queue = queueOf('A');
    withAfter(queue, 'q1', ['r1']);
    editItem(queue, 'q1', { postponed: true }, 4);
    startQueue(queue, [], 5);
    const failed = failedRun('r1');
    expect(itemReadiness(queue, queue.items[0]!, lookupOf(failed))).toBe('blocked');
    expect(advance(queue, [failed], lookupOf(failed), 6).take).toEqual([]);
  });

  it('stops a queue without autopilot that has only postponed items', () => {
    const queue = queueOf('A');
    editItem(queue, 'q1', { postponed: true }, 3);
    startQueue(queue, [], 4);
    advance(queue, [], none, 5);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(1);
  });

  it('stops an empty queue with auto answer on and autopilot off', () => {
    const queue = queueOf('A');
    queue.autoAnswer = true;
    queue.autopilot = false;
    editItem(queue, 'q1', { postponed: true }, 3);
    startQueue(queue, [], 4);
    advance(queue, [], none, 5);
    expect(queue.status).toBe('stopped');
  });

  it('keeps a queue with autopilot running over postponed items', () => {
    const queue = queueOf('A');
    queue.autopilot = true;
    editItem(queue, 'q1', { postponed: true }, 3);
    startQueue(queue, [], 4);
    advance(queue, [], none, 5);
    expect(queue.status).toBe('running');
  });
});

describe('adopting a retried run', () => {
  /** A run that failed and finished, then is retried: the group works again. */
  function retried(id: string): { state: RunState; keys: string[] } {
    const state = failedRun(id);
    state.run.config.delivery.auto = false;
    state.run.finishedAt = 10;
    const keys = problemKeys(state);
    state.run.finishedAt = null;
    group(state).status = 'running';
    return { state, keys };
  }

  function stoppedQueue(): Queue {
    const queue = queueOf('W');
    startQueue(queue, [], 3);
    queue.status = 'stopped';
    queue.stop = { kind: 'problem', run: 'a', group: 'gruppa-1', reason: 'failed' };
    return queue;
  }

  it('adds a revived run and learns the keys, leaving the state and the stop', () => {
    const queue = stoppedQueue();
    const { state, keys } = retried('a');
    expect(keys.length).toBe(1);
    expect(adoptRun(queue, state, keys, 9)).toEqual({ frozen: null });
    expect(queue.runs).toEqual(['a']);
    expect(queue.acknowledged).toEqual(expect.arrayContaining(keys));
    expect(queue).toMatchObject({
      status: 'stopped',
      stop: { kind: 'problem', run: 'a' },
      updatedAt: 9,
    });
  });

  it('removes the return item of the run', () => {
    const queue = stoppedQueue();
    addItem(queue, { pipeline: 'feature', task: 't' }, 'ret', 4).run = 'a';
    const { state, keys } = retried('a');
    expect(adoptRun(queue, state, keys, 9)).toEqual({ frozen: null });
    expect(ids(queue)).toEqual(['q1']);
  });

  it('does nothing for a run that holds a place, a skipped one, a finished one or a foreign one', () => {
    const { state, keys } = retried('a');
    const held = stoppedQueue();
    held.runs.push('a');
    const finished = stoppedQueue();
    const done = failedRun('b');
    done.run.finishedAt = 10;
    const foreign = emptyQueue('/other', 1);
    for (const [queue, target] of [
      [held, state],
      [finished, done],
      [foreign, state],
    ] as const) {
      const before = JSON.stringify(queue);
      expect(adoptRun(queue, target, keys, 9)).toBeNull();
      expect(JSON.stringify(queue)).toBe(before);
    }
  });

  it('adopts a skipped run: it leaves the skipped list and holds a place once', () => {
    const queue = stoppedQueue();
    queue.skipped.push('a');
    const { state, keys } = retried('a');
    expect(adoptRun(queue, state, keys, 9)).toEqual({ frozen: null });
    expect(queue).toMatchObject({ skipped: [], runs: ['a'] });
  });

  it('keeps waiting items until both adopted runs release their places', () => {
    const queue = queueOf('W');
    queue.parallel = 1;
    startQueue(queue, [], 3);
    const a = retried('a');
    const b = retried('b');
    adoptRun(queue, a.state, a.keys, 4);
    adoptRun(queue, b.state, b.keys, 4);
    const lookup = lookupOf(a.state, b.state);
    expect(advance(queue, [a.state, b.state], lookup, 5).take).toEqual([]);
    a.state.run.finishedAt = 10;
    group(a.state).status = 'merged';
    expect(advance(queue, [a.state, b.state], lookup, 6).take).toEqual([]);
    expect(queue.runs).toEqual(['b']);
    b.state.run.finishedAt = 10;
    group(b.state).status = 'merged';
    expect(advance(queue, [a.state, b.state], lookup, 7).take.map((item) => item.id)).toEqual([
      'q1',
    ]);
  });

  it('does not stop a running queue for the remaining failed group', () => {
    const queue = queueOf('W');
    startQueue(queue, [], 3);
    const state = run(2, { id: 'a' });
    step(state);
    group(state, 'gruppa-1').status = 'failed';
    group(state, 'gruppa-2').status = 'failed';
    const keys = problemKeys(state);
    group(state, 'gruppa-1').status = 'running';
    expect(adoptRun(queue, state, keys, 4)).toEqual({ frozen: null });
    advance(queue, [state], lookupOf(state), 5);
    expect(queue).toMatchObject({ status: 'running', stop: null });
  });

  it('stops a running queue for a new problem of the retried group', () => {
    const queue = queueOf('W');
    startQueue(queue, [], 3);
    const { state, keys } = retried('a');
    adoptRun(queue, state, keys, 4);
    group(state).attempts.push(structuredClone(group(state).attempts[0]!));
    group(state).status = 'failed';
    advance(queue, [state], lookupOf(state), 5);
    expect(queue).toMatchObject({
      status: 'stopped',
      stop: { kind: 'problem', run: 'a', group: 'gruppa-1' },
    });
  });
});

describe('dismiss of a skipped run', () => {
  function skippedQueue(state: RunState): Queue {
    const queue = queueOf('A', 'B');
    queue.skipFailed = true;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', state.run.id, 4);
    advance(queue, [state], lookupOf(state), 5);
    return queue;
  }

  function applyFailedRun(id: string): RunState {
    const state = mergedRun(id, false);
    group(state).delivery = { ...group(state).delivery, state: 'apply_failed' };
    return state;
  }

  it('removes a skipped run with a failed delivery and leaves the run as it was', () => {
    const state = applyFailedRun('a');
    const queue = skippedQueue(state);
    expect(queue.skipped).toEqual(['a']);
    expect(canReturn(queue, state)).toBe(false);
    dismissRun(queue, state, 9);
    expect(queue).toMatchObject({ skipped: [], runs: [], updatedAt: 9 });
    expect(queue.acknowledged.filter((key) => key.startsWith('a/'))).toEqual([]);
    expect(group(state)).toMatchObject({ status: 'merged', delivery: { state: 'apply_failed' } });
  });

  it('refuses a run that is not skipped', () => {
    const state = failedRun('a');
    const queue = queueOf('A');
    expect(() => dismissRun(queue, state, 9)).toThrow('run is not in the skipped list');
  });

  it('does not bring the dismissed run back on the next advance', () => {
    const state = applyFailedRun('a');
    const queue = skippedQueue(state);
    dismissRun(queue, state, 9);
    advance(queue, [state], lookupOf(state), 10);
    expect(queue).toMatchObject({ skipped: [], runs: [] });
  });

  it('keeps a task that waits for the dismissed run blocked', () => {
    const state = failedRun('a');
    const queue = skippedQueue(state);
    withAfter(queue, 'q2', ['a']);
    const waiting = queue.items.find((item) => item.id === 'q2')!;
    expect(itemReadiness(queue, waiting, lookupOf(state))).toBe('blocked');
    dismissRun(queue, state, 9);
    advance(queue, [state], lookupOf(state), 10);
    expect(queue.skipped).toEqual([]);
    const after = queue.items.find((item) => item.id === 'q2')!;
    expect(itemReadiness(queue, after, lookupOf(state))).toBe('blocked');
  });
});

describe('can return', () => {
  it('is false without failed groups and true for a failed skipped run', () => {
    const failed = failedRun('a');
    const queue = emptyQueue('/repo', 1);
    queue.skipped = ['a'];
    expect(canReturn(queue, failed)).toBe(true);
    const merged = mergedRun('b', false);
    group(merged).delivery = { ...group(merged).delivery, state: 'apply_failed' };
    expect(canReturn(queue, merged)).toBe(false);
  });

  it('is false for a run that holds a place or is already an item', () => {
    const failed = failedRun('a');
    const queue = emptyQueue('/repo', 1);
    queue.runs = ['a'];
    expect(canReturn(queue, failed)).toBe(false);
    queue.runs = [];
    queue.items.push({ ...queueOf('A').items[0]!, run: 'a' });
    expect(canReturn(queue, failed)).toBe(false);
  });
});
