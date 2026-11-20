import { describe, expect, it } from 'vitest';

import {
  addItem,
  editItem,
  emptyQueue,
  returnRun,
  pauseRun,
  type Queue,
} from '../../../src/feature/queue/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';
import { authorOf, createdBySystemOf } from '../../../src/feature/identity/types/index.ts';
import { run, step } from '../runs/helpers.ts';
import { temporaryStorage } from '../storage.ts';

function queueWith(author?: string | null, createdBySystem?: boolean): Queue {
  const queue = emptyQueue('/repo', 1);
  addItem(
    queue,
    {
      pipeline: 'feature',
      task: 'A',
      ...(author === undefined ? {} : { author }),
      ...(createdBySystem ? { createdBySystem } : {}),
    },
    'q1',
    2,
  );
  return queue;
}

describe('the author of a task', () => {
  it('is the one who added it, and null when nobody is named', () => {
    expect(queueWith('alice').items[0]?.author).toBe('alice');
    expect(queueWith().items[0]?.author).toBeNull();
    expect(queueWith(null).items[0]?.author).toBeNull();
  });

  it('is not changed by an edit', () => {
    const queue = queueWith('alice');
    editItem(queue, 'q1', { task: 'Changed by bob', postponed: true }, 3);
    expect(queue.items[0]).toMatchObject({ task: 'Changed by bob', author: 'alice' });
  });

  it('is kept when the queue is written and read again', () => {
    const store = temporaryStorage();
    store.queues.saveQueue(queueWith('alice'));
    expect(store.queues.loadQueue('/repo')!.items[0]?.author).toBe('alice');
    store.database.close();
  });

  it('is the id of a user and null for local and system actors', () => {
    const user = { id: 'u1', email: 'a@x.io', name: 'A' };
    expect(authorOf({ kind: 'user', user, attributes: {} })).toBe('u1');
    expect(authorOf({ kind: 'local' })).toBeNull();
    expect(authorOf({ kind: 'system' })).toBeNull();
  });

  it('goes to the item that returns a run, the way pause and return keep it', () => {
    const state = run(1, { author: 'alice' });
    step(state);
    transition(state, { kind: 'cancel', group: null }, 3000);
    const queue = emptyQueue('/repo', 1);
    expect(returnRun(queue, state, 'r1', 5).author).toBe('alice');
    const paused = run(1, { id: 'run000000002', author: 'alice' });
    step(paused);
    const other = emptyQueue('/repo', 1);
    expect(pauseRun(other, paused, 'r2', 5).author).toBe('alice');
    const none = run(1, { id: 'run000000003' });
    step(none);
    expect(pauseRun(emptyQueue('/repo', 1), none, 'r3', 5).author).toBeNull();
  });
});

describe('the mark of the system', () => {
  it('is set for the system actor only, and kept by the queue and the database', () => {
    const user = { id: 'u1', email: 'a@x.io', name: 'A' };
    expect(createdBySystemOf({ kind: 'system' })).toBe(true);
    expect(createdBySystemOf({ kind: 'local' })).toBe(false);
    expect(createdBySystemOf({ kind: 'user', user, attributes: {} })).toBe(false);
    expect(queueWith(null, true).items[0]).toMatchObject({ author: null, createdBySystem: true });
    expect(queueWith(null).items[0]?.createdBySystem).toBe(false);
    const store = temporaryStorage();
    store.queues.saveQueue(queueWith(null, true));
    expect(store.queues.loadQueue('/repo')!.items[0]?.createdBySystem).toBe(true);
    store.database.close();
  });

  it('goes to the run, and back to the queue on return and pause; a retry keeps it', () => {
    const state = run(1, { createdBySystem: true });
    expect(state.run.createdBySystem).toBe(true);
    step(state);
    transition(state, { kind: 'cancel', group: null }, 3000);
    expect(returnRun(emptyQueue('/repo', 1), state, 'r1', 5).createdBySystem).toBe(true);
    transition(state, { kind: 'retry', group: 'group-1' }, 6000);
    expect(state.run.createdBySystem).toBe(true);
    const store = temporaryStorage();
    store.runs.saveRun(state);
    store.runs.saveRun(run(1, { id: 'run-b' }));
    expect(store.runs.loadRun(state.run.id)!.run.createdBySystem).toBe(true);
    expect(store.runs.loadRun('run-b')!.run.createdBySystem).toBe(false);
    store.database.close();
    const paused = run(1, { id: 'run000000002', createdBySystem: true });
    step(paused);
    expect(pauseRun(emptyQueue('/repo', 1), paused, 'r2', 5).createdBySystem).toBe(true);
  });
});

describe('the author of a run', () => {
  it('is the author of the task and survives a retry', () => {
    const state = run(1, { author: 'alice' });
    expect(state.run.author).toBe('alice');
    step(state);
    transition(state, { kind: 'cancel', group: null }, 3000);
    transition(state, { kind: 'retry', group: 'group-1' }, 6000);
    expect(state.run.author).toBe('alice');
  });

  it('is null without an author, and is kept in the database', () => {
    const store = temporaryStorage();
    const withAuthor = run(1, { id: 'run-a', author: 'alice' });
    const without = run(1, { id: 'run-b' });
    store.runs.saveRun(withAuthor);
    store.runs.saveRun(without);
    expect(without.run.author).toBeNull();
    expect(store.runs.loadRun('run-a')!.run.author).toBe('alice');
    expect(store.runs.loadRun('run-b')!.run.author).toBeNull();
    store.database.close();
  });
});
