import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type QueueView, type RunCreated } from '../../src/protocol/index.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG } from './harness.ts';
import { start, queueOf, add, waitQueue, allRuns, WRITE_LIB } from './queue-harness.ts';

describe('queue contents', () => {
  it('starts empty, stopped, with parallel 1', async () => {
    const h = await start();
    expect(await queueOf(h)).toMatchObject({ status: 'stopped', parallel: 1, items: [], runs: [] });
  });

  it('adds without starting, finds the queue from a subdirectory, and keeps the order', async () => {
    const h = await start();
    mkdirSync(join(h.repo, 'app'), { recursive: true });
    await h.call('queue_add', {
      repository: join(h.repo, 'app'),
      workflow: 'feature',
      task: 'работа',
      title: 'A',
    });
    const view = await add(h, 'B');
    await add(h, 'C');
    expect(view.items.map((item) => item.title)).toEqual(['A', 'B']);
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items.map((item) => item.title)).toEqual(['A', 'B', 'C']);
    expect(await allRuns(h)).toEqual([]);
    const moved = (await h.call('queue_edit', {
      repository: h.repo,
      item: queue.items[2]!.id,
      position: 1,
    })) as QueueView;
    expect(moved.items.map((item) => item.title)).toEqual(['C', 'A', 'B']);
    expect(moved.items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('stores a task with groups', async () => {
    const h = await start();
    const view = (await h.call('queue_add', {
      repository: h.repo,
      workflow: 'feature',
      groups: [
        { title: 'Вход', task: 'форма входа' },
        { title: 'Регистрация', task: 'форма регистрации' },
      ],
    })) as QueueView;
    expect(view.items[0]).toMatchObject({ task: null });
    expect(view.items[0]?.groups).toHaveLength(2);
  });

  it('rejects an unknown workflow and leaves the queue unchanged', async () => {
    const h = await start();
    await expect(
      h.call('queue_add', { repository: h.repo, workflow: 'nope', task: 'x' }),
    ).rejects.toThrow('unknown workflow `nope`; known: feature');
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('edits and removes a waiting item, and rejects a missing one', async () => {
    const h = await start();
    const { item } = await add(h, 'A');
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      task: 'A2',
      title: null,
    })) as QueueView;
    expect(edited.items[0]).toMatchObject({ task: 'A2', title: null });
    const removed = (await h.call('queue_remove', { repository: h.repo, item })) as QueueView;
    expect(removed.items).toEqual([]);
    await expect(h.call('queue_remove', { repository: h.repo, item })).rejects.toThrow(
      'unknown queue item',
    );
  });
});

describe('running the queue', () => {
  it('runs one task at a time and gives the next one the delivered result', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, { read: ['lib.ts'] }] });
    await add(h, 'первая');
    await add(h, 'вторая');
    await h.call('queue_start', { repository: h.repo });
    const first = await queueOf(h);
    expect(first.status).toBe('running');
    expect(first.runs).toHaveLength(1);
    expect(first.items).toHaveLength(1);
    const done = await waitQueue(h, (queue) => queue.status === 'stopped');
    expect(done).toMatchObject({ items: [], runs: [] });
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.fromQueue)).toBe(true);
    expect(runs.map((run) => run.state)).toEqual(['finished', 'finished']);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads.at(-1)!).contents['lib.ts']).toBe('export const value = 2;\n');
  });

  it('frees the place at the end of a run when delivery is manual', async () => {
    const h = await start(MANUAL_CONFIG);
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const [runId] = (await queueOf(h)).runs.map((run) => run.id);
    await h.waitFor(runId!, (view) => view.finished);
    // delivery.auto is false: the place is free once the run is finished
    const queue = await waitQueue(h, (view) => view.items.length === 0);
    expect(queue.items).toEqual([]);
  });

  it('starts two runs at once with parallel 2', async () => {
    const h = await start();
    const hold = { waitFor: h.gate('ab') };
    h.script({ code: [hold, hold, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await add(h, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const queue = await queueOf(h);
    expect(queue.runs).toHaveLength(2);
    expect(queue.items.map((item) => item.title)).toEqual(['C']);
    h.open('ab');
    await waitQueue(h, (view) => view.status === 'stopped');
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('takes an added task at once when a place is free in a running queue', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await add(h, 'A');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    expect((await queueOf(h)).runs).toHaveLength(1);
    const queue = await add(h, 'B');
    expect(queue.runs).toHaveLength(2);
    expect(queue.items).toEqual([]);
    h.open('a');
    await waitQueue(h, (view) => view.status === 'stopped');
  });

  it('does not run while paused, and does not interrupt a running run', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const paused = (await h.call('queue_pause', { repository: h.repo })) as QueueView;
    expect(paused.status).toBe('stopped');
    const [runId] = paused.runs.map((run) => run.id);
    h.open('a');
    const final = await h.waitFor(runId!, (view) => view.finished);
    expect(final.state).toBe('finished');
    // the run left its place: a running queue would take B now
    const queue = await waitQueue(h, (view) => !view.runs.some((run) => run.id === runId));
    expect(queue.runs).toEqual([]);
    expect(queue.items).toHaveLength(1);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('keeps running on a question to a human and goes on after the answer', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const waiting = await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    expect(waiting.status).toBe('running');
    expect(waiting.stop).toBeNull();
    expect(waiting.items).toHaveLength(1);
    const run = waiting.runs[0]!;
    const group = (await h.status(run.id)).groups[0]!.slug;
    await h.call('answer', { runId: run.id, group, answer: 'пароль' });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.stop).toBeNull();
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('takes the next task when started again after a failed run', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.stop).toBeNull();
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('keeps an item first with an error when its workflow disappeared', async () => {
    const h = await start();
    await add(h, 'A');
    writeConfigDirectory(h.repo, WORKFLOW_CONFIG.replace('feature:', 'other:'));
    await h.call('queue_start', { repository: h.repo });
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toMatchObject({ kind: 'item' });
    expect(queue.items[0]?.error).toContain('unknown workflow');
    expect(await allRuns(h)).toEqual([]);
  });

  it('runs an item now over the limit and the run holds a place of the queue', async () => {
    const h = await start();
    const hold = { waitFor: h.gate('ab') };
    h.script({ code: [hold, hold, {}] });
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await add(h, 'A');
    await add(h, 'B');
    const c = await add(h, 'C');
    const d = await add(h, 'D');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.runs.length === 2);
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: d.item,
    })) as RunCreated;
    const queue = await queueOf(h);
    expect(queue.runs).toHaveLength(3);
    expect(queue.parallel).toBe(2);
    expect(queue.status).toBe('running');
    expect(queue.items.map((item) => item.id)).toEqual([c.item]);
    expect(queue.runs.map((run) => run.id)).toContain(created.runId);
    expect((await h.status(created.runId)).fromQueue).toBe(true);
    await expect(h.call('queue_run_now', { repository: h.repo, item: d.item })).rejects.toThrow(
      'unknown queue item',
    );
    // C starts only when two of the three runs have left their places
    const sizes = new Set<number>([queue.runs.length]);
    const two = await waitQueue(h, (view) => {
      sizes.add(view.runs.length);
      return view.runs.length === 2;
    });
    expect(two.items.map((item) => item.id)).toEqual([c.item]);
    h.open('ab');
    await waitQueue(h, (view) => {
      sizes.add(view.runs.length);
      if (view.runs.length >= 3) {
        expect(view.items.map((item) => item.id)).toEqual([c.item]);
      }
      return view.status === 'stopped' && view.items.length === 0;
    });
    expect(Math.max(...sizes)).toBe(3);
    expect(sizes.has(4)).toBe(false);
    expect(await allRuns(h)).toHaveLength(4);
  });

  it('runs an item now in a stopped queue and leaves the queue stopped', async () => {
    const h = await start();
    await add(h, 'A');
    const b = await add(h, 'B');
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: b.item,
    })) as RunCreated;
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(1);
    expect(queue.runs.map((run) => run.id)).toEqual([created.runId]);
  });

  it('stops the queue when a run started now fails', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('never') }, { noReport: true }] });
    await add(h, 'A');
    await add(h, 'B');
    const c = await add(h, 'C');
    await h.call('queue_start', { repository: h.repo });
    // the held agent of A has started, so the run started now takes the failing action
    await waitQueue(
      h,
      (view) => view.runs.length === 1 && existsSync(join(h.fakeState, 'calls.jsonl')),
    );
    const now = (await h.call('queue_run_now', {
      repository: h.repo,
      item: c.item,
    })) as RunCreated;
    const stopped = await waitQueue(h, (view) => view.stop !== null);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed', run: now.runId });
  });

  it('restores the queue after the daemon restarts and keeps watching its runs', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('never') }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    // the agent of A has started and is held: the restart interrupts it
    await waitQueue(
      h,
      (queue) => queue.runs.length === 1 && existsSync(join(h.fakeState, 'calls.jsonl')),
    );
    await h.restart();
    // the interrupted attempt of A is a new problem: the queue stops, B still waits
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    expect(stopped.items.map((item) => item.title)).toEqual(['B']);
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.runs).toEqual([]);
    expect(await allRuns(h)).toHaveLength(2);
  });
});
