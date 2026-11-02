import { describe, expect, it } from 'vitest';

import {
  QUEUE_PARALLEL_MAX,
  addItem,
  advance,
  createRun,
  dependencyState,
  editItem,
  emptyQueue,
  itemFailed,
  itemReadiness,
  itemStarted,
  moveItem,
  occupiesSlot,
  pauseQueue,
  removeItem,
  runPhase,
  runProblems,
  setParallel,
  startQueue,
  transition,
  type Queue,
  type QueueItem,
  type RunState,
} from '../../src/core/index.ts';

import { config, finish, group, run, step } from './helpers.ts';

function queueOf(...tasks: string[]): Queue {
  const queue = emptyQueue('/repo', 1);
  tasks.forEach((task, index) => addItem(queue, { workflow: 'feature', task }, `q${index + 1}`, 2));
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
    addItem(queue, { workflow: 'feature', task: '  C  ', title: ' Вход ' }, 'q3', 5);
    expect(ids(queue)).toEqual(['q1', 'q2', 'q3']);
    expect(queue.items[2]).toMatchObject({ task: 'C', groups: null, title: 'Вход', error: null });
  });

  it('takes groups instead of a task', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(
      queue,
      {
        workflow: 'feature',
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
    fail({ workflow: 'feature' });
    fail({ workflow: 'feature', task: 'x', groups: [{ title: 'a', task: 'b' }] });
    fail({ workflow: 'feature', task: '  ' });
    fail({ workflow: 'feature', groups: [] });
    fail({ workflow: 'feature', groups: [{ title: ' ', task: 'b' }] });
    fail({ workflow: 'feature', groups: [{ title: 'a', task: ' ' }] });
    fail({ workflow: 'feature', task: 'x', title: '  ' });
    fail({ workflow: 'feature', task: 'x', title: 'я'.repeat(61) });
    expect(() =>
      addItem(queue, { workflow: 'feature', task: 'x', title: 'я'.repeat(60) }, 'q', 1),
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
    expect(() => editItem(queue, 'q1', { workflow: 'other', task: ' ', position: 2 }, 9)).toThrow();
    expect(() => editItem(queue, 'q1', { workflow: 'other', position: 5 }, 9)).toThrow();
    expect(queue.items[0]).toMatchObject({ workflow: 'feature', task: 'A' });
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
    expect(addItem(queue, { workflow: 'feature', task: 'A' }, 'q1', 2).autoDeliver).toBeNull();
    expect(
      addItem(queue, { workflow: 'feature', task: 'B', autoDeliver: false }, 'q2', 2).autoDeliver,
    ).toBe(false);
    expect(
      addItem(queue, { workflow: 'feature', task: 'C', autoDeliver: true }, 'q3', 2).autoDeliver,
    ).toBe(true);
  });

  it('changes only when the patch names it, and null resets it', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'A', autoDeliver: false }, 'q1', 2);
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
    expect(addItem(queue, { workflow: 'feature', task: 'A' }, 'q1', 2).skip).toEqual([]);
    expect(
      addItem(queue, { workflow: 'feature', task: 'B', skip: ['qa', 'review', 'qa'] }, 'q2', 2)
        .skip,
    ).toEqual(['qa', 'review']);
  });

  it('is replaced as a whole, cleared by [] and kept by other edits', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'A', skip: ['qa'] }, 'q1', 2);
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
    itemFailed(queue, 'q1', 'unknown workflow `feature`; known: none', 4);
    expect(queue).toMatchObject({
      status: 'stopped',
      stop: { kind: 'item', item: 'q1' },
    });
    expect(ids(queue)).toEqual(['q1', 'q2']);
    expect(queue.items[0]?.error).toContain('unknown workflow');
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
      repository: '/repo',
      workflow: 'feature',
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
      { workflow: 'feature', task: 'x', tags: ['tg-a', 'tg-b', 'tg-a'] },
      'q1',
      2,
    );
    expect(tagged.tags).toEqual(['tg-a', 'tg-b']);
    expect(addItem(queue, { workflow: 'feature', task: 'y' }, 'q2', 2).tags).toEqual([]);
  });

  it('replaces the tags on edit only when they are passed', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 2);
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
    repository: '/repo',
    workflow: 'feature',
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
      { workflow: 'feature', task: 'B', after: ['q1', 'q1', 'r9'] },
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
      addItem(queue, { workflow: 'feature', task: 'X', after: ['q4'] }, 'q4', 4),
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
