import { describe, expect, it } from 'vitest';

import {
  emptyQueue,
  fillGlobalPositions,
  globalOrder,
  moveGlobal,
  placeNewItems,
  restoreProjectOrder,
  type Queue,
  type QueueItem,
} from '../../../src/feature/queue/types/index.ts';

function item(id: string, createdAt: number, extra: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    number: 1,
    pipeline: 'feature',
    variant: 'default',
    provider: null,
    author: null,
    createdBySystem: false,
    task: id,
    groups: null,
    title: null,
    autoDeliver: null,
    deliveryMode: null,
    deliveryBranch: null,
    tags: [],
    inheritTags: true,
    skip: [],
    after: [],
    postponed: false,
    createdAt,
    error: null,
    run: null,
    ...extra,
  };
}

function queue(repository: string, items: QueueItem[]): Queue {
  return { ...emptyQueue(repository, 0), items };
}

const ids = (queues: Queue[]): string[] => globalOrder(queues).map((entry) => entry.item.id);

describe('the order of the global queue', () => {
  it('starts as the order of adding tasks when the mode is turned on', () => {
    const queues = [
      queue('/app', [item('a', 1000), item('c', 1020)]),
      queue('/lib', [item('b', 1010)]),
    ];
    fillGlobalPositions(queues);
    expect(ids(queues)).toEqual(['a', 'b', 'c']);
    expect(globalOrder(queues).map((entry) => entry.item.globalPosition)).toEqual([1, 2, 3]);
  });

  it('breaks a tie of the time by id', () => {
    const queues = [queue('/app', [item('q2', 500)]), queue('/lib', [item('q1', 500)])];
    fillGlobalPositions(queues);
    expect(ids(queues)).toEqual(['q1', 'q2']);
  });

  it('moves a task through the projects', () => {
    const queues = [queue('/app', [item('a', 1), item('c', 3)]), queue('/lib', [item('b', 2)])];
    fillGlobalPositions(queues);
    moveGlobal(queues, 'c', 1);
    expect(ids(queues)).toEqual(['c', 'a', 'b']);
    expect(globalOrder(queues).map((entry) => entry.item.globalPosition)).toEqual([1, 2, 3]);
  });

  it('puts the tasks back into their projects in the global order', () => {
    const queues = [queue('/app', [item('a', 1), item('c', 3)]), queue('/lib', [item('b', 2)])];
    fillGlobalPositions(queues);
    moveGlobal(queues, 'c', 1);
    restoreProjectOrder(queues);
    expect(queues[0]!.items.map((entry) => entry.id)).toEqual(['c', 'a']);
    expect(queues[1]!.items.map((entry) => entry.id)).toEqual(['b']);
    for (const entry of queues.flatMap((one) => one.items)) {
      expect(entry.globalPosition).toBeUndefined();
    }
  });

  it('puts a returned run first and a new task last', () => {
    const queues = [
      queue('/app', [item('a', 1), item('n', 9), item('r', 8, { run: 'run1' })]),
      queue('/lib', [item('b', 2)]),
    ];
    queues[0]!.items[0]!.globalPosition = 1;
    queues[1]!.items[0]!.globalPosition = 2;
    expect(placeNewItems(queues)).toBe(true);
    expect(ids(queues)).toEqual(['r', 'a', 'b', 'n']);
    expect(placeNewItems(queues)).toBe(false);
  });
});
