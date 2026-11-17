import { describe, expect, it } from 'vitest';

import { addItem, editItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';

describe('the provider of a queue item', () => {
  it('is null without one and kept when given', () => {
    const queue = emptyQueue('/repo', 1);
    const plain = addItem(queue, { pipeline: 'feature', task: 'a' }, 'q1', 2);
    const chosen = addItem(queue, { pipeline: 'feature', task: 'b', provider: 'zai' }, 'q2', 3);
    expect(plain.provider).toBeNull();
    expect(chosen.provider).toBe('zai');
  });

  it('changes on edit, resets with null and stays when the patch does not name it', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', provider: 'zai' }, 'q1', 2);
    expect(editItem(queue, 'q1', { title: 'x' }, 3).provider).toBe('zai');
    expect(editItem(queue, 'q1', { provider: 'openai' }, 4).provider).toBe('openai');
    const reset = editItem(queue, 'q1', { provider: null }, 5);
    expect(reset.provider).toBeNull();
    expect(reset.title).toBe('x');
  });

  it('is refused on an item that stands for a returned run', () => {
    const queue = emptyQueue('/repo', 1);
    const item = addItem(queue, { pipeline: 'feature', task: 'a' }, 'q1', 2);
    item.run = 'run000000001';
    expect(() => editItem(queue, 'q1', { provider: null }, 3)).toThrow(
      'a returned run keeps its own task',
    );
  });
});
