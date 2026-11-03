import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type QueueView,
  type RunCreated,
  type StreamEvent,
} from '../../src/protocol/index.ts';
import { MANUAL_CONFIG, POLL_MS, WORKFLOW_CONFIG, startRun, until } from './harness.ts';
import {
  start,
  stop,
  queueOf,
  add,
  waitQueue,
  allRuns,
  WRITE_LIB,
  WORKER_QUEUE_CONFIG,
  itemById,
  run_,
} from './queue-harness.ts';

const queuesOf = (events: StreamEvent[]): QueueView[] =>
  events.flatMap((event) => (event.event === 'queue' ? [event.queue as unknown as QueueView] : []));

describe('dependencies of queue items', () => {
  it('resolves ids of items, started items and runs, and rejects unknown ones', async () => {
    const h = await start();
    // A holds its run: the ids are checked while it runs
    h.script({ code: [{ waitFor: h.gate('a') }] });
    const first = await add(h, 'A');
    const second = await add(h, 'B', { after: [first.item, first.item] });
    expect(itemById(second, second.item)?.after).toEqual([
      expect.objectContaining({ kind: 'item', id: first.item, state: 'waiting' }),
    ]);
    expect(itemById(second, second.item)?.readiness).toBe('waiting');
    await expect(add(h, 'C', { after: ['nope'] })).rejects.toThrow('unknown dependency `nope`');
    await expect(
      h.call('queue_edit', { repository: h.repo, item: first.item, after: [second.item] }),
    ).rejects.toThrow('dependency cycle');
    await expect(
      h.call('queue_edit', { repository: h.repo, item: first.item, after: [first.item] }),
    ).rejects.toThrow('a task cannot depend on itself');
    expect((await queueOf(h)).items).toHaveLength(2);
    await h.call('queue_start', { repository: h.repo });
    const running = await waitQueue(h, (queue) => queue.runs.length === 1);
    const runId = running.runs[0]!.id;
    expect(itemById(running, second.item)?.after).toEqual([
      expect.objectContaining({ kind: 'run', id: runId }),
    ]);
    // the id of an item that became a run still works
    const third = await add(h, 'C', { after: [first.item] });
    expect(itemById(third, third.item)?.after.map((dependency) => dependency.id)).toEqual([runId]);
    expect((await allRuns(h)).map((run) => run.id)).toContain(runId);
  });

  it('queues a run with an unfinished dependency and starts the stopped queue', async () => {
    const h = await start();
    h.script({ code: [{ ...WRITE_LIB, waitFor: h.gate('a') }, {}] });
    const first = await add(h, 'A');
    const queued = await run_(h, 'B', [first.item]);
    expect(queued.run).toBeNull();
    expect(queued.queue.status).toBe('running');
    expect(queued.queue.runs).toHaveLength(1);
    expect(queued.queue.items).toHaveLength(1);
    expect(queued.queue.items[0]).toMatchObject({ readiness: 'waiting' });
    h.open('a');
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('starts a run at once when its dependency is done', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const [done] = await waitQueue(h, (queue) => queue.runs.length === 1).then((queue) =>
      queue.runs.map((run) => run.id),
    );
    await h.waitFor(done!, (view) => view.finished && view.delivery.applied === 1);
    await waitQueue(h, (queue) => queue.status === 'stopped');
    const queued = await run_(h, 'B', [done!]);
    expect(queued.run).not.toBeNull();
    await h.waitFor(queued.run!.runId, (view) => view.finished);
  });

  it('starts an independent task before a dependent one and the dependent one after delivery', async () => {
    const h = await start();
    // A and C both run; whichever took the first action finishes first, the other one after it
    h.script({
      code: [
        { ...WRITE_LIB, waitFor: h.gate('first') },
        { waitFor: h.gate('second') },
        { read: ['lib.ts'] },
      ],
    });
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    await add(h, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const first = await queueOf(h);
    expect(first.runs).toHaveLength(2);
    expect(first.items.map((item) => item.id)).toEqual([b.item]);
    expect(first.items[0]).toMatchObject({ readiness: 'waiting' });
    h.open('first');
    await waitQueue(h, (queue) => queue.runs.length < 2);
    h.open('second');
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const runs = await allRuns(h);
    expect(runs.map((run) => run.title)).toEqual(['A', 'C', 'B']);
    expect(runs.every((run) => run.state === 'finished')).toBe(true);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads.at(-1)!).contents['lib.ts']).toBe('export const value = 2;\n');
  });

  it('waits for apply when the predecessor is not delivered automatically', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, { read: ['lib.ts'] }] });
    const a = await add(h, 'A', { autoDeliver: false });
    await add(h, 'B', { after: [a.item] });
    await h.call('queue_start', { repository: h.repo });
    const [runId] = (await waitQueue(h, (queue) => queue.runs.length === 1)).runs.map(
      (run) => run.id,
    );
    await h.waitFor(runId!, (view) => view.finished);
    // nothing starts B while A waits for apply
    await new Promise((resolve) => setTimeout(resolve, 200));
    const waiting = await queueOf(h);
    expect(waiting.status).toBe('running');
    expect(waiting.items).toHaveLength(1);
    expect(waiting.items[0]).toMatchObject({ readiness: 'waiting' });
    await h.call('apply', { runId: runId! });
    await waitQueue(h, (queue) => queue.items.length === 0 && queue.status === 'stopped');
    expect(await allRuns(h)).toHaveLength(2);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads.at(-1)!).contents['lib.ts']).toBe('export const value = 2;\n');
  });

  it('blocks on a failed predecessor, becomes ready after a retry and starts only with the queue', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    expect(itemById(stopped, b.item)).toMatchObject({ readiness: 'blocked' });
    const runId = (await allRuns(h))[0]!.id;
    const view = await h.status(runId);
    const retryEvents: StreamEvent[] = [];
    const retryEnded = subscribe(h.socket, (line) =>
      retryEvents.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await h.call('retry', { runId, group: view.groups[0]!.slug });
    await h.waitFor(
      runId,
      (current) => current.finished && current.groups.every((g) => g.delivery === 'applied'),
    );
    const ready = await waitQueue(h, (queue) => itemById(queue, b.item)?.readiness === 'ready');
    expect(ready.status).toBe('stopped');
    expect(ready.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    // the stopped queue changed only in readiness: subscribers still get a queue event
    await until('a queue event with B ready', () =>
      queuesOf(retryEvents).some(
        (queue) => queue.status === 'stopped' && itemById(queue, b.item)?.readiness === 'ready',
      ),
    );
    // a ready item does not start a stopped queue
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await allRuns(h)).toHaveLength(1);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    expect(await allRuns(h)).toHaveLength(2);
    await stop(h);
    expect(await retryEnded).toBe('closed');
  });

  it('runs a blocked task now and points its successors at the run', async () => {
    const h = await start();
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    const c = await add(h, 'C', { after: [b.item] });
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: b.item,
    })) as RunCreated;
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.id)).toEqual([a.item, c.item]);
    expect(itemById(queue, c.item)?.after.map((dependency) => dependency.id)).toEqual([
      created.runId,
    ]);
    expect(queue.status).toBe('stopped');
    await h.waitFor(created.runId, (view) => view.finished);
  });

  it('keeps the dependencies after a restart', async () => {
    const h = await start();
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    await h.restart();
    const queue = await queueOf(h);
    expect(itemById(queue, b.item)?.after).toEqual([
      expect.objectContaining({ kind: 'item', id: a.item }),
    ]);
  });

  it('chains tasks added by a specialist through the ids of earlier answers', async () => {
    const h = await start(WORKER_QUEUE_CONFIG);
    h.script({
      code: [
        {
          queueChain: [
            { workflow: 'feature', task: 'модель', title: 'модель' },
            { workflow: 'feature', task: 'API', title: 'API', after: ['$prev'] },
          ],
        },
      ],
    });
    const created = await startRun(h, { repository: h.repo, workflow: 'feature', task: 'итоги' });
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.title)).toEqual(['модель', 'API']);
    expect(queue.items[1]!.after.map((dependency) => dependency.id)).toEqual([queue.items[0]!.id]);
    expect(queue.items[1]).toMatchObject({ readiness: 'waiting' });
  });

  it('starts a task after a restart once the run it waits for is delivered', async () => {
    const h = await start(MANUAL_CONFIG);
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    await h.call('queue_start', { repository: h.repo });
    const [runId] = (await queueOf(h)).runs.map((run) => run.id);
    await h.waitFor(runId!, (view) => view.finished);
    await h.restart();
    const waiting = await queueOf(h);
    expect(itemById(waiting, b.item)).toMatchObject({ readiness: 'waiting' });
    expect(itemById(waiting, b.item)?.after).toEqual([
      expect.objectContaining({ kind: 'run', id: runId, state: 'waiting' }),
    ]);
    expect(await allRuns(h)).toHaveLength(1);
    await h.call('apply', { runId: runId! });
    await waitQueue(h, (queue) => queue.items.length === 0);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.fromQueue)).toBe(true);
  });

  it('reports a workflow error before an unknown dependency', async () => {
    const h = await start();
    await expect(add(h, 'A', { workflow: 'nope', after: ['missing'] })).rejects.toThrow(
      'unknown workflow',
    );
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('chains a task to an item queued by an earlier step', async () => {
    const h = await start(
      WORKFLOW_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, queue: true }',
      ).replace(
        'reviewer: { name: Ревьюер, permissions: read }',
        'reviewer: { name: Ревьюер, permissions: read, queue: true }',
      ),
    );
    h.script({
      code: [{ ...WRITE_LIB, queue: { workflow: 'feature', task: 'модель', title: 'модель' } }],
      review: [
        {
          queue: { workflow: 'feature', task: 'API', title: 'API', after: ['$last'] },
        },
      ],
    });
    const created = await startRun(h, { repository: h.repo, workflow: 'feature', task: 'итоги' });
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.title)).toEqual(['модель', 'API']);
    expect(queue.items[1]!.after.map((dependency) => dependency.id)).toEqual([queue.items[0]!.id]);
    expect(queue.items[1]).toMatchObject({ readiness: 'waiting' });
  });

  it('sends a queue event when the readiness of an item changes', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, {}] });
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    await until('queue events with B waiting on a run', () => {
      const queues = queuesOf(events);
      return (
        queues.some((queue) => itemById(queue, b.item)?.readiness === 'waiting') &&
        queues.some((queue) => itemById(queue, b.item)?.after[0]?.kind === 'run')
      );
    });
    await stop(h);
    expect(await ended).toBe('closed');
  });

  it('drops a skipped run after its retry succeeds and sends a queue event', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.skipped.length === 1 && queue.items.length === 0);
    const runId = (await allRuns(h))[0]!.id;
    const view = await h.status(runId);
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await h.call('retry', { runId, group: view.groups[0]!.slug });
    await waitQueue(h, (queue) => queue.skipped.length === 0);
    await until('a queue event without skipped runs', () =>
      queuesOf(events).some((queue) => queue.skipped.length === 0),
    );
    await stop(h);
    expect(await ended).toBe('closed');
  });

  it('sends a queue event with the new autoDeliver after delivery.auto is written', async () => {
    const h = await start();
    await add(h, 'A');
    const before = await queueOf(h);
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    const value = before.autoDeliver !== true;
    await h.call('config_setting', {
      repository: h.repo,
      path: 'delivery.auto',
      value,
      revision: null,
      level: 'global',
    });
    await until('a queue event with the new autoDeliver', () =>
      queuesOf(events).some((queue) => queue.autoDeliver === value),
    );
    expect(queuesOf(events).at(-1)?.autoDeliver).toBe(value);
    await stop(h);
    expect(await ended).toBe('closed');
  });
});
