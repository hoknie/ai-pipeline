import { describe, expect, it } from 'vitest';
import { addItem, editItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';
import {
  checkDeliveryBranch,
  validDeliveryBranchName,
} from '../../../src/feature/runs/types/index.ts';

describe('delivery target', () => {
  it.each(['feature/new', 'main', 'release/v1.0'])('accepts %s', (name) => {
    expect(validDeliveryBranchName(name)).toBe(true);
  });
  it.each(['', '@', '-bad', '.hidden', 'a//b', 'a..b', 'a.lock', 'a b', 'a@{b', 'a~b'])(
    'rejects %s',
    (name) => {
      expect(validDeliveryBranchName(name)).toBe(false);
    },
  );
  it('checks strategies and effective delivery settings', () => {
    const target = { name: 'feature/new', strategy: 'create' } as const;
    expect(() => checkDeliveryBranch(target, true, 'commit')).not.toThrow();
    expect(() =>
      checkDeliveryBranch({ ...target, strategy: 'existing' }, true, 'commit'),
    ).not.toThrow();
    expect(() =>
      checkDeliveryBranch({ ...target, strategy: 'other' } as never, true, 'commit'),
    ).toThrow();
    expect(() => checkDeliveryBranch(target, false, 'commit')).toThrow();
    expect(() => checkDeliveryBranch(target, true, 'branch')).toThrow();
    expect(() => checkDeliveryBranch(target, true, 'worktree')).toThrow();
    expect(() => checkDeliveryBranch(target, true, 'commit', true)).toThrow();
  });
  it('adds, edits, retains and resets a target without mutating on refusal', () => {
    const queue = emptyQueue('/repo', 0);
    const target = { name: 'feature/new', strategy: 'create' } as const;
    const item = addItem(
      queue,
      {
        pipeline: 'p',
        task: 'task',
        autoDeliver: true,
        deliveryMode: 'commit',
        deliveryBranch: target,
      },
      'q',
      1,
    );
    editItem(queue, 'q', { title: 'title' }, 2);
    expect(item.deliveryBranch).toEqual(target);
    expect(() => editItem(queue, 'q', { autoDeliver: false }, 3)).toThrow();
    expect(item.autoDeliver).toBe(true);
    editItem(queue, 'q', { deliveryBranch: { name: 'main', strategy: 'existing' } }, 4);
    expect(item.deliveryBranch?.name).toBe('main');
    editItem(queue, 'q', { deliveryBranch: null, autoDeliver: false }, 5);
    expect(item.deliveryBranch).toBeNull();
  });
  it('rejects @ before adding a queue item', () => {
    const queue = emptyQueue('/repo', 0);
    expect(() =>
      addItem(
        queue,
        { pipeline: 'p', task: 'x', deliveryBranch: { name: '@', strategy: 'create' } },
        'q',
        1,
      ),
    ).toThrow(/deliveryBranch/);
    expect(queue.items).toEqual([]);
  });
});
