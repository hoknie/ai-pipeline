import { describe, expect, it } from 'vitest';

import {
  addItem,
  advance,
  claimPlace,
  emptyQueue,
  freezeCandidate,
  pauseRun,
  removeItem,
  returnRun,
  transition,
  type Queue,
  type RunState,
} from '../../src/core/index.ts';

import { group, run, step } from './helpers.ts';

const lookupOf =
  (...states: RunState[]) =>
  (id: string): RunState | undefined =>
    states.find((state) => state.run.id === id);

function working(id: string): RunState {
  const state = run(1, { id });
  state.run.config.delivery.auto = false;
  step(state);
  return state;
}

function failed(id: string): RunState {
  const state = working(id);
  group(state).status = 'failed';
  state.run.finishedAt = 9;
  return state;
}

function queueWith(parallel: number, ...runs: string[]): Queue {
  const queue = emptyQueue('/repo', 1);
  queue.parallel = parallel;
  queue.status = 'running';
  queue.runs = [...runs];
  return queue;
}

const freezeIt = (state: RunState): void => {
  transition(state, { kind: 'hold', hold: 'frozen' }, 8);
};

describe('freeze candidate', () => {
  it('is the run that took a place last', () => {
    const [a, b] = [working('a'), working('b')];
    const queue = queueWith(2, 'a', 'b');
    expect(freezeCandidate(queue, [a, b], null)).toBe('b');
  });

  it('skips a run that waits for a human, a priority run, a held run and a finished one', () => {
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(working) as [
      RunState,
      RunState,
      RunState,
      RunState,
      RunState,
    ];
    const queue = queueWith(5, 'a', 'b', 'c', 'd', 'e');
    group(e).status = 'needs_human';
    queue.priority = ['d'];
    transition(c, { kind: 'hold', hold: 'paused' }, 8);
    expect(freezeCandidate(queue, [a, b, c, d, e], null)).toBe('b');
    b.run.finishedAt = 9;
    expect(freezeCandidate(queue, [a, b, c, d, e], null)).toBe('a');
  });

  it('never picks the claimant and returns null when there is nobody', () => {
    const [a, b] = [working('a'), working('b')];
    const queue = queueWith(2, 'a', 'b');
    expect(freezeCandidate(queue, [a, b], 'b')).toBe('a');
    queue.priority = ['a', 'b'];
    expect(freezeCandidate(queue, [a, b], null)).toBeNull();
  });
});

describe('claim of a place', () => {
  it('takes a free place without freezing anything and marks the run as priority', () => {
    const a = working('a');
    const queue = queueWith(2, 'a');
    expect(claimPlace(queue, [a], 'c', 'ret', 5)).toBeNull();
    expect(queue.runs).toEqual(['a', 'c']);
    expect(queue.priority).toEqual(['c']);
    expect(queue.items).toEqual([]);
  });

  it('freezes the last taken run: it leaves the places and its item goes first', () => {
    const [a, b] = [working('a'), working('b')];
    const queue = queueWith(2, 'a', 'b');
    addItem(queue, { pipeline: 'feature', task: 'W' }, 'q1', 2);
    queue.acknowledged = ['b/gruppa-1/failed/1'];
    expect(claimPlace(queue, [a, b], 'c', 'ret', 5)).toBe('b');
    expect(queue.runs).toEqual(['a', 'c']);
    expect(queue.priority).toEqual(['c']);
    expect(queue.items.map((item) => item.run ?? item.id)).toEqual(['b', 'q1']);
    expect(queue.acknowledged).toEqual([]);
    expect(queue.status).toBe('running');
  });

  it('takes the place over parallel when nobody can be frozen', () => {
    const [a, b] = [working('a'), working('b')];
    group(a).status = 'needs_human';
    group(b).status = 'needs_human';
    const queue = queueWith(2, 'a', 'b');
    expect(claimPlace(queue, [a, b], 'c', 'ret', 5)).toBeNull();
    expect(queue.runs).toEqual(['a', 'b', 'c']);
    expect(queue.items).toEqual([]);
  });

  it('does not freeze a priority run for the next priority action', () => {
    const [a, b] = [working('a'), working('b')];
    const queue = queueWith(1, 'a');
    expect(claimPlace(queue, [a], 'b', 'r1', 5)).toBe('a');
    expect(claimPlace(queue, [b], 'd', 'r2', 6)).toBeNull();
    expect(queue.runs).toEqual(['b', 'd']);
  });
});

describe('advance with frozen runs', () => {
  function frozenQueue(): { queue: Queue; frozen: RunState; c: RunState } {
    const queue = queueWith(1, 'c');
    const frozen = working('b');
    addItem(queue, { pipeline: 'feature', task: 'W' }, 'q1', 2);
    queue.items.unshift({ ...queue.items[0]!, id: 'rb', run: 'b', task: null });
    queue.priority = ['c'];
    freezeIt(frozen);
    const c = working('c');
    return { queue, frozen, c };
  }

  it('keeps the frozen item while the priority run holds the place', () => {
    const { queue, frozen, c } = frozenQueue();
    const { take, freeze } = advance(queue, [c], lookupOf(frozen, c), 9);
    expect(take).toEqual([]);
    expect(freeze).toEqual([]);
    expect(queue.priority).toEqual(['c']);
  });

  it('takes the frozen item first when the place is free, in a stopped queue too', () => {
    const { queue, frozen, c } = frozenQueue();
    queue.status = 'stopped';
    c.run.finishedAt = 9;
    const { take } = advance(queue, [c], lookupOf(frozen, c), 9);
    expect(take.map((item) => item.id)).toEqual(['rb']);
    expect(queue.runs).toEqual([]);
    expect(queue.priority).toEqual([]);
    expect(queue.status).toBe('stopped');
  });

  it('puts the frozen item before ready tasks in a running queue', () => {
    const { queue, frozen, c } = frozenQueue();
    c.run.finishedAt = 9;
    const { take } = advance(queue, [c], lookupOf(frozen, c), 9);
    expect(take.map((item) => item.id)).toEqual(['rb']);
  });

  it('still takes a frozen run that failed while finishing its step, ahead of other items', () => {
    const { queue, frozen, c } = frozenQueue();
    group(frozen).status = 'failed';
    frozen.run.finishedAt = 9;
    expect(frozen.run.hold).toBe('frozen');
    expect(advance(queue, [c], lookupOf(frozen, c), 9).take).toEqual([]);
    queue.status = 'stopped';
    c.run.finishedAt = 9;
    expect(advance(queue, [c], lookupOf(frozen, c), 10).take.map((item) => item.id)).toEqual([
      'rb',
    ]);
  });
});

describe('advance takes returned runs by freezing', () => {
  function returned(status: 'running' | 'stopped'): {
    queue: Queue;
    a: RunState;
    c: RunState;
  } {
    const queue = queueWith(1, 'a');
    queue.status = status;
    const a = working('a');
    const c = failed('c');
    returnRun(queue, c, 'rc', 4);
    return { queue, a, c };
  }

  it('takes the item of a failed run at once and freezes the run that holds the place', () => {
    const { queue, a, c } = returned('running');
    const { take, freeze } = advance(queue, [a], lookupOf(a, c), 5);
    expect(take.map((item) => item.id)).toEqual(['rc']);
    expect(freeze).toEqual(['a']);
    expect(queue.runs).toEqual(['c']);
    expect(queue.priority).toEqual(['c']);
    expect(queue.items.map((item) => item.run)).toEqual(['a', 'c']);
  });

  it('leaves the item in a stopped queue', () => {
    const { queue, a, c } = returned('stopped');
    const { take, freeze } = advance(queue, [a], lookupOf(a, c), 5);
    expect(take).toEqual([]);
    expect(freeze).toEqual([]);
    expect(queue.runs).toEqual(['a']);
  });

  it('does not take the item of a run on pause that failed, nor freeze for it', () => {
    const queue = queueWith(1, 'b');
    const b = working('b');
    const p = working('p');
    pauseRun(queue, p, 'rp', 4);
    transition(p, { kind: 'hold', hold: 'paused' }, 4);
    group(p).status = 'failed';
    p.run.finishedAt = 9;
    const { take, freeze } = advance(queue, [b], lookupOf(b, p), 5);
    expect(take).toEqual([]);
    expect(freeze).toEqual([]);
    expect(queue.runs).toEqual(['b']);
  });
});

describe('pause and removal of a frozen run', () => {
  function frozenQueue(finished: boolean): { queue: Queue; b: RunState } {
    const queue = queueWith(1, 'c');
    const b = working('b');
    addItem(queue, { pipeline: 'feature', task: 'D' }, 'q1', 2);
    claimPlace(queue, [b], 'x', 'rb', 3);
    queue.runs = ['c'];
    freezeIt(b);
    if (finished) {
      group(b).status = 'failed';
      b.run.finishedAt = 9;
    }
    return { queue, b };
  }

  it('moves the item to the end and changes the hold to paused', () => {
    const { queue, b } = frozenQueue(false);
    queue.items.unshift({ ...queue.items[0]!, id: 'rb', run: 'b', task: null });
    const item = pauseRun(queue, b, 'new', 7);
    transition(b, { kind: 'hold', hold: 'paused' }, 7);
    expect(item.id).toBe('rb');
    expect(queue.items.map((entry) => entry.run ?? entry.id)).toEqual(['q1', 'b']);
    expect(b.run.hold).toBe('paused');
  });

  it('accepts a frozen run that finished with failed groups, without a second item', () => {
    const { queue, b } = frozenQueue(true);
    queue.items.unshift({ ...queue.items[0]!, id: 'rb', run: 'b', task: null });
    expect(() => pauseRun(queue, b, 'new', 7)).not.toThrow();
    transition(b, { kind: 'hold', hold: 'paused' }, 7);
    expect(queue.items.filter((entry) => entry.run === 'b')).toHaveLength(1);
    expect(b.run.hold).toBe('paused');
  });

  it('refuses to remove the item of an unfinished frozen run and allows a finished one', () => {
    const open = frozenQueue(false);
    open.queue.items.unshift({ ...open.queue.items[0]!, id: 'rb', run: 'b', task: null });
    expect(() => removeItem(open.queue, 'rb', 8, lookupOf(open.b))).toThrow(
      'a frozen run stays in the queue; continue or cancel it',
    );
    const done = frozenQueue(true);
    done.queue.items.unshift({ ...done.queue.items[0]!, id: 'rb', run: 'b', task: null });
    removeItem(done.queue, 'rb', 8, lookupOf(done.b));
    expect(done.queue.items.some((entry) => entry.id === 'rb')).toBe(false);
  });
});

describe('priority list', () => {
  it('drops a run that leaves the places', () => {
    const queue = queueWith(2, 'a', 'b');
    queue.priority = ['b'];
    const a = working('a');
    const b = working('b');
    b.run.finishedAt = 9;
    advance(queue, [a, b], lookupOf(a, b), 5);
    expect(queue.runs).toEqual(['a']);
    expect(queue.priority).toEqual([]);
  });
});
