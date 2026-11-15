import { describe, expect, it } from 'vitest';

import {
  addItem,
  checkDependencies,
  dependencyState,
  dependencyTags,
  emptyQueue,
  itemReadiness,
  itemStarted,
  lookupIn,
  removeItem,
  type Queue,
} from '../../../src/feature/queue/types/index.ts';

const none = (): undefined => undefined;

/** Two projects: `lib` holds q1 «API», `web` holds q2 «Клиент». */
function projects(): { lib: Queue; web: Queue } {
  const lib = emptyQueue('/work/lib', 1);
  const web = emptyQueue('/work/web', 1);
  addItem(lib, { pipeline: 'feature', task: 'API' }, 'q1', 2);
  addItem(web, { pipeline: 'feature', task: 'Клиент' }, 'q2', 2);
  return { lib, web };
}

describe('dependencies between queues', () => {
  it('finds a cycle through two queues', () => {
    const { lib, web } = projects();
    web.items[0]!.after = ['q1'];
    expect(() => checkDependencies(lookupIn(lib, web), 'q1', ['q2'])).toThrow(
      'dependency cycle: q1 → q2 → q1',
    );
    // within one queue the other project is unknown: no cycle is seen
    expect(() => checkDependencies(lookupIn(lib), 'q1', ['q2'])).not.toThrow();
  });

  it('calls a waiting item of another queue waiting, and a blocked one blocked', () => {
    const { lib, web } = projects();
    web.items[0]!.after = ['q1'];
    const find = lookupIn(lib, web);
    expect(dependencyState(find, 'q1', none)).toBe('waiting');
    expect(itemReadiness(find, web.items[0]!, none)).toBe('waiting');
    // q1 waits for a run nobody knows: it is blocked, and so is the item that waits for it
    lib.items[0]!.after = ['gone'];
    expect(dependencyState(find, 'q1', none)).toBe('blocked');
    expect(itemReadiness(find, web.items[0]!, none)).toBe('blocked');
  });

  it('ends on a cycle in stored data through two queues', () => {
    const { lib, web } = projects();
    lib.items[0]!.after = ['q2'];
    web.items[0]!.after = ['q1'];
    const find = lookupIn(lib, web);
    expect(itemReadiness(find, lib.items[0]!, none)).toBe('waiting');
    expect(itemReadiness(find, web.items[0]!, none)).toBe('waiting');
  });

  it('does not inherit the tags of a predecessor from another repository', () => {
    const { lib, web } = projects();
    lib.items[0]!.tags = ['auth'];
    addItem(web, { pipeline: 'feature', task: 'свой' }, 'q3', 3);
    web.items[1]!.tags = ['own'];
    const find = lookupIn(lib, web);
    expect(dependencyTags(web, ['q1'], none, find)).toEqual([]);
    expect(dependencyTags(web, ['q1', 'q3'], none, find)).toEqual(['own']);
  });

  it('points the items of another queue at the run when the predecessor starts', () => {
    const { lib, web } = projects();
    web.items[0]!.after = ['q1'];
    const touched = itemStarted(lib, 'q1', 'r1', 5, [lib, web]);
    expect(touched).toEqual([web]);
    expect(web.items[0]!.after).toEqual(['r1']);
    expect(web.updatedAt).toBe(5);
    expect(lib.runs).toEqual(['r1']);
  });

  it('reports no other queue when nothing waited for the started item', () => {
    const { lib, web } = projects();
    expect(itemStarted(lib, 'q1', 'r1', 5, [lib, web])).toEqual([]);
  });

  it('drops the removed predecessor from the items of another queue', () => {
    const { lib, web } = projects();
    addItem(lib, { pipeline: 'feature', task: 'B' }, 'q4', 3);
    web.items[0]!.after = ['q1', 'q4'];
    const touched = removeItem(lib, 'q1', 6, undefined, [lib, web]);
    expect(touched).toEqual([web]);
    expect(web.items[0]!.after).toEqual(['q4']);
  });
});
