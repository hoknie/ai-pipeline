import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type RunCreated,
  type RunQueued,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';
import { workerQueueAddParams } from '../../src/presentation/ipc/contract/index.ts';
import { start, stop, queueOf, add, waitQueue, allRuns } from './queue-harness.ts';

describe('fixed run goes first', () => {
  it('keeps the place of a retried skipped run over the waiting tasks', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}, {}] });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.skipped.length === 1);
    const runId = (await allRuns(h))[0]!.id;
    const view = await h.status(runId);
    await h.call('retry', { runId, group: view.groups[0]!.slug });
    const back = await waitQueue(h, (queue) => queue.skipped.length === 0);
    expect(back.runs.map((run) => run.id)).toContain(runId);
    await waitQueue(h, (queue) => queue.runs.length === 0);
  });
});

describe('postponed items', () => {
  it('skips a postponed item in a running queue and takes the next one', async () => {
    const h = await start();
    const a = await add(h, 'A', { postponed: true });
    await add(h, 'B');
    expect(a.items[0]).toMatchObject({ id: a.item, postponed: true });
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (view) => view.status === 'stopped' && view.runs.length === 0 && view.items.length === 1,
    );
    expect(done.items[0]).toMatchObject({ id: a.item, postponed: true, title: 'A' });
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('starts the item at once when the flag is cleared in a running queue', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('b') }, {}] });
    const a = await add(h, 'A', { postponed: true });
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.runs.length === 1);
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    const view = (await h.call('queue_edit', {
      repository: h.repo,
      item: a.item,
      postponed: false,
    })) as QueueView;
    expect(view.items).toEqual([]);
    expect(view.runs).toHaveLength(2);
    h.open('b');
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.runs.length === 0);
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('runs a postponed item now', async () => {
    const h = await start();
    const a = await add(h, 'A', { postponed: true });
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: a.item,
    })) as RunCreated;
    expect(created.runId).toBeTruthy();
    expect((await queueOf(h)).items).toEqual([]);
    await h.status(created.runId);
  });

  it('keeps the flag after the daemon restarts and rejects a non-boolean value', async () => {
    const h = await start();
    const a = await add(h, 'A');
    await expect(
      h.call('queue_edit', { repository: h.repo, item: a.item, postponed: 'yes' as never }),
    ).rejects.toThrow();
    expect((await queueOf(h)).items[0]).toMatchObject({ id: a.item, postponed: false });
    const view = (await h.call('queue_edit', {
      repository: h.repo,
      item: a.item,
      postponed: true,
    })) as QueueView;
    expect(view.items[0]!.postponed).toBe(true);
    await h.restart();
    expect((await queueOf(h)).items[0]).toMatchObject({ id: a.item, postponed: true });
  });

  it('drops postponed from run and worker_queue_add', async () => {
    const h = await start();
    const a = await add(h, 'A');
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
      title: 'R',
      after: [a.item],
      ...({ postponed: true } as object),
    })) as RunQueued;
    expect(queued.item).toBeTruthy();
    const view = await queueOf(h);
    expect(view.items.length + view.runs.length).toBe(2);
    expect(view.items.every((item) => !item.postponed)).toBe(true);
    expect(view.items.find((item) => item.id === queued.item)?.postponed ?? false).toBe(false);
    const parsed = workerQueueAddParams.parse({
      token: 't',
      pipeline: 'feature',
      task: 'x',
      postponed: true,
    });
    expect('postponed' in parsed).toBe(false);
  });

  it('sends a queue event when the flag changes', async () => {
    const h = await start();
    const a = await add(h, 'A');
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await h.call('queue_edit', { repository: h.repo, item: a.item, postponed: true });
    const queues = () =>
      events.flatMap((event) =>
        event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
      );
    await waitQueue(h, () => queues().some((queue) => queue.items.some((item) => item.postponed)));
    await stop(h);
    expect(await ended).toBe('closed');
  });
});

describe('retried runs join the queue', () => {
  it('shows a retried run of a stopped queue among the places and keeps waiting tasks', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, { waitFor: h.gate('retry') }] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop?.kind === 'problem');
    const runId = (stopped.stop as { run: string }).run;
    expect(stopped.runs).toEqual([]);
    await h.call('retry', { runId, group: (await h.status(runId)).groups[0]!.slug });
    const view = await queueOf(h);
    expect(view.runs.map((card) => card.id)).toEqual([runId]);
    expect(view).toMatchObject({ status: 'stopped', stop: { kind: 'problem', run: runId } });
    expect(view.items).toHaveLength(1);
    h.open('retry');
    await h.waitFor(runId, (run) => run.state === 'finished');
    await waitQueue(h, (queue) => queue.runs.length === 0);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('keeps both retried runs among the places and does not take tasks meanwhile', async () => {
    const h = await start();
    h.script({
      code: [{ noReport: true }, { noReport: true }, { waitFor: h.gate('retries') }],
    });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const failed = await waitQueue(
      h,
      (queue) => queue.runs.length === 0 && queue.items.length === 0 && queue.stop !== undefined,
    );
    expect(failed.runs).toEqual([]);
    expect(failed.skipped).toEqual([]);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    await h.call('queue_settings', { repository: h.repo, parallel: 1 });
    await add(h, 'C');
    for (const run of runs) {
      await h.call('retry', { runId: run.id, group: (await h.status(run.id)).groups[0]!.slug });
    }
    const started = (await h.call('queue_start', { repository: h.repo })) as QueueView;
    expect(started.status).toBe('running');
    const view = await queueOf(h);
    expect(view.status).toBe('running');
    expect(view.runs.map((card) => card.id).sort()).toEqual(runs.map((run) => run.id).sort());
    expect(view.items).toHaveLength(1);
    expect(await allRuns(h)).toHaveLength(2);
    h.open('retries');
    for (const run of runs) await h.waitFor(run.id, (item) => item.state === 'finished');
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.runs.length === 0);
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('leaves the queue as it is when the retry is rejected', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop?.kind === 'problem');
    const runId = (stopped.stop as { run: string }).run;
    await expect(h.call('retry', { runId, group: 'no-such-group' })).rejects.toThrow();
    const after = await queueOf(h);
    expect(after.runs).toEqual([]);
    expect(after.updatedAt).toBe(stopped.updatedAt);
  });
});
