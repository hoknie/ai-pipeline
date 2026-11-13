import { describe, expect, it } from 'vitest';

import {
  addItem,
  advance,
  emptyQueue,
  isFilterEmpty,
  matchesFilter,
  setQueueFilter,
  setQueueSettings,
  startQueue,
  type Queue,
} from '../../../src/feature/queue/types/index.ts';

const none = (): undefined => undefined;

function queueOf(): Queue {
  const queue = emptyQueue('/repo', 1);
  addItem(queue, { pipeline: 'feature', task: 'A', tags: ['auth'] }, 'q1', 2);
  addItem(queue, { pipeline: 'explore', task: 'B', tags: ['auth', 'v2'] }, 'q2', 3);
  addItem(queue, { pipeline: 'feature', task: 'C' }, 'q3', 4);
  return queue;
}

describe('take filter', () => {
  it('is empty for a new queue and matches everything', () => {
    const queue = queueOf();
    expect(queue.filter).toEqual({ pipelines: [], tags: [] });
    expect(isFilterEmpty(queue.filter)).toBe(true);
    expect(queue.items.every((item) => matchesFilter(queue.filter, item))).toBe(true);
  });

  it('needs the pipeline and at least one tag', () => {
    const queue = queueOf();
    const [a, b, c] = queue.items as [
      (typeof queue.items)[0],
      (typeof queue.items)[0],
      (typeof queue.items)[0],
    ];
    expect(matchesFilter({ pipelines: ['feature'], tags: [] }, a)).toBe(true);
    expect(matchesFilter({ pipelines: ['feature'], tags: [] }, b)).toBe(false);
    expect(matchesFilter({ pipelines: [], tags: ['v2', 'x'] }, b)).toBe(true);
    expect(matchesFilter({ pipelines: [], tags: ['v2'] }, a)).toBe(false);
    expect(matchesFilter({ pipelines: ['feature'], tags: ['auth'] }, a)).toBe(true);
    expect(matchesFilter({ pipelines: ['feature'], tags: ['auth'] }, b)).toBe(false);
    expect(matchesFilter({ pipelines: ['feature'], tags: ['auth'] }, c)).toBe(false);
  });

  it('matches a returned run always', () => {
    const queue = queueOf();
    queue.items[1]!.run = 'r1';
    expect(matchesFilter({ pipelines: ['feature'], tags: ['zzz'] }, queue.items[1]!)).toBe(true);
  });

  it('replaces only the passed lists, without repeats', () => {
    const queue = queueOf();
    setQueueFilter(queue, { pipelines: ['feature', 'feature', 'explore'], tags: ['auth'] }, 5);
    expect(queue.filter).toEqual({ pipelines: ['feature', 'explore'], tags: ['auth'] });
    setQueueFilter(queue, { tags: [] }, 6);
    expect(queue.filter).toEqual({ pipelines: ['feature', 'explore'], tags: [] });
    expect(queue.updatedAt).toBe(6);
  });

  it('refuses an empty patch and a running queue without a change', () => {
    const queue = queueOf();
    expect(() => setQueueFilter(queue, {}, 5)).toThrow('pass filter.pipelines or filter.tags');
    startQueue(queue, [], 5);
    expect(() => setQueueFilter(queue, { pipelines: ['feature'] }, 6)).toThrow(
      'queue filter can be changed only while the queue is stopped',
    );
    expect(queue.filter).toEqual({ pipelines: [], tags: [] });
  });

  it('refuses the whole request in a running queue before any change', () => {
    const queue = queueOf();
    startQueue(queue, [], 5);
    expect(() =>
      setQueueSettings(queue, { filter: { pipelines: ['feature'] }, parallel: 2 }, 6),
    ).toThrow('queue filter can be changed only while the queue is stopped');
    expect(queue.parallel).toBe(1);
  });

  it('sets the filter together with other settings in a stopped queue', () => {
    const queue = queueOf();
    setQueueSettings(queue, { filter: { tags: ['auth'] }, parallel: 2 }, 6);
    expect(queue).toMatchObject({ parallel: 2, filter: { pipelines: [], tags: ['auth'] } });
  });

  it('skips a task that does not fit when taking', () => {
    const queue = queueOf();
    queue.parallel = 3;
    setQueueFilter(queue, { pipelines: ['explore'] }, 5);
    startQueue(queue, [], 6);
    const { take } = advance(queue, [], none, 7);
    expect(take.map((item) => item.id)).toEqual(['q2']);
    expect(queue.status).toBe('running');
  });

  it('stops a queue without autopilot when nothing fits', () => {
    const queue = queueOf();
    setQueueFilter(queue, { tags: ['nope'] }, 5);
    startQueue(queue, [], 6);
    expect(advance(queue, [], none, 7).take).toEqual([]);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(3);
  });

  it('keeps a queue with autopilot running when nothing fits', () => {
    const queue = queueOf();
    queue.autopilot = true;
    setQueueFilter(queue, { tags: ['nope'] }, 5);
    startQueue(queue, [], 6);
    expect(advance(queue, [], none, 7).take).toEqual([]);
    expect(queue.status).toBe('running');
  });

  it('does not stop on a postponed item that fits, but ignores one that does not', () => {
    const queue = queueOf();
    setQueueFilter(queue, { pipelines: ['explore'] }, 5);
    queue.items[1]!.postponed = true;
    startQueue(queue, [], 6);
    advance(queue, [], none, 7);
    expect(queue.status).toBe('stopped');
  });
});
