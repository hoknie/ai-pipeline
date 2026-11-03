import { execFileSync } from 'node:child_process';
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
import { writeConfigDirectory } from '../fixtures/config.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG, startRun } from './harness.ts';
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

describe('dependencies of queue items', () => {
  it('resolves ids of items, started items and runs, and rejects unknown ones', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, {}] });
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
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    expect((await allRuns(h)).map((run) => run.id)).toContain(runId);
  });

  it('queues a run with an unfinished dependency and starts the stopped queue', async () => {
    const h = await start();
    h.script({ code: [{ ...WRITE_LIB, delayMs: 1500 }, {}] });
    const first = await add(h, 'A');
    const queued = await run_(h, 'B', [first.item]);
    expect(queued.run).toBeNull();
    expect(queued.queue.status).toBe('running');
    expect(queued.queue.runs).toHaveLength(1);
    expect(queued.queue.items).toHaveLength(1);
    expect(queued.queue.items[0]).toMatchObject({ readiness: 'waiting' });
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
    h.script({ code: [{ ...WRITE_LIB, delayMs: 1200 }, { delayMs: 2500 }, { read: ['lib.ts'] }] });
    const a = await add(h, 'A');
    const b = await add(h, 'B', { after: [a.item] });
    await add(h, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const first = await queueOf(h);
    expect(first.runs).toHaveLength(2);
    expect(first.items.map((item) => item.id)).toEqual([b.item]);
    expect(first.items[0]).toMatchObject({ readiness: 'waiting' });
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
    await new Promise((resolve) => setTimeout(resolve, 800));
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await allRuns(h)).toHaveLength(1);
    // the stopped queue changed only in readiness: subscribers still get a queue event
    const readyEvent = retryEvents.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    expect(
      readyEvent.some(
        (queue) => queue.status === 'stopped' && itemById(queue, b.item)?.readiness === 'ready',
      ),
    ).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queues = events.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    expect(queues.some((queue) => itemById(queue, b.item)?.readiness === 'waiting')).toBe(true);
    expect(queues.some((queue) => itemById(queue, b.item)?.after[0]?.kind === 'run')).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queues = events.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    expect(queues.some((queue) => queue.skipped.length === 0)).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queues = events.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    expect(queues.at(-1)?.autoDeliver).toBe(value);
    await stop(h);
    expect(await ended).toBe('closed');
  });
});

describe('queue settings', () => {
  it('starts a new queue with a waiting task when the autopilot is turned on', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 3000 }] });
    await add(h, 'A');
    const view = (await h.call('queue_settings', {
      repository: h.repo,
      autopilot: true,
    })) as QueueView;
    expect(view).toMatchObject({ status: 'running', autopilot: true, skipFailed: false });
    expect(view.runs).toHaveLength(1);
    expect(view.items).toEqual([]);
  });

  it('keeps an empty running queue on the autopilot and takes a task added later', async () => {
    const h = await start();
    h.script({ code: [{}, {}] });
    await h.call('queue_settings', { repository: h.repo, autopilot: true });
    await add(h, 'A');
    const done = await waitQueue(h, (queue) => queue.items.length === 0 && queue.runs.length === 0);
    expect(done.status).toBe('running');
    await add(h, 'B');
    await waitQueue(h, (queue) => queue.items.length === 0 && queue.runs.length === 0);
    expect(await allRuns(h)).toHaveLength(2);
    expect((await queueOf(h)).status).toBe('running');
    const off = (await h.call('queue_settings', {
      repository: h.repo,
      autopilot: false,
    })) as QueueView;
    expect(off.status).toBe('stopped');
  });

  it('does not start a task added to a paused queue on the autopilot', async () => {
    const h = await start();
    await h.call('queue_settings', { repository: h.repo, autopilot: true });
    await h.call('queue_pause', { repository: h.repo });
    const view = await add(h, 'A');
    expect(view.status).toBe('stopped');
    expect(view.runs).toEqual([]);
    expect(await allRuns(h)).toEqual([]);
  });

  it('does not lift a stop when the autopilot is turned on', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    const view = (await h.call('queue_settings', {
      repository: h.repo,
      autopilot: true,
    })) as QueueView;
    expect(view).toMatchObject({ status: 'stopped', autopilot: true, stop: stopped.stop });
    expect(view.items).toHaveLength(1);
  });

  it('does not stop on a failed run when failed runs are skipped', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (queue) => queue.skipped.length === 1 && queue.items.length === 0 && queue.runs.length === 0,
    );
    expect(done.stop).toBeNull();
    expect(done.skipped[0]).toMatchObject({ problem: { reason: 'failed' } });
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('keeps settings and skipped runs after the daemon restarts', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await h.call('queue_settings', { repository: h.repo, skipFailed: true, autopilot: true });
    await waitQueue(h, (queue) => queue.skipped.length === 1);
    await h.restart();
    const view = await queueOf(h);
    expect(view).toMatchObject({ autopilot: true, skipFailed: true });
    expect(view.skipped).toHaveLength(1);
  });

  it('rejects an empty settings request and leaves the queue unchanged', async () => {
    const h = await start();
    await expect(h.call('queue_settings', { repository: h.repo })).rejects.toThrow(
      'pass parallel, autopilot, autopilotAnswer, skipFailed or onLimit',
    );
    expect(await queueOf(h)).toMatchObject({ autopilot: false, skipFailed: false, parallel: 1 });
  });

  it('keeps an item with an error and goes on when failed runs are skipped', async () => {
    const h = await start();
    await add(h, 'A');
    await add(h, 'B');
    writeConfigDirectory(h.repo, WORKFLOW_CONFIG.replace('feature:', 'other:'));
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    const view = await waitQueue(h, (queue) => queue.items.every((item) => item.error !== null));
    expect(view.status).toBe('running');
    expect(view.stop).toBeNull();
    expect(view.items.map((item) => item.error)).toEqual([
      expect.stringContaining('unknown workflow'),
      expect.stringContaining('unknown workflow'),
    ]);
    expect(await allRuns(h)).toEqual([]);
  });
});

describe('delivery mode per task', () => {
  it('keeps the mode of an item, resets it with null and shows the setting', async () => {
    const h = await start();
    const first = await add(h, 'A', { deliveryMode: 'branch' });
    expect(first.deliveryMode).toBe('worktree');
    expect(first.items[0]?.deliveryMode).toBe('branch');
    expect((await add(h, 'B')).items[1]?.deliveryMode).toBeNull();
    const reset = (await h.call('queue_edit', {
      repository: h.repo,
      item: first.item,
      deliveryMode: null,
    })) as QueueView;
    expect(reset.items[0]?.deliveryMode).toBeNull();
  });

  it('delivers an item with the branch mode as a branch and leaves the working tree', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, {}] });
    const { item } = await add(h, 'A', { deliveryMode: 'branch' });
    expect(item).toBeTruthy();
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped');
    const [created] = await allRuns(h);
    expect(created?.deliveryMode).toBe('branch');
    await h.waitFor(created!.id, (run) => run.finished);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 1;\n');
    expect(
      execFileSync('git', ['branch', '--list', 'aip/*'], { cwd: h.repo }).toString().trim(),
    ).toBe(`aip/${created!.id}`);
  });

  it('takes the setting when the task without a mode starts', async () => {
    const h = await start();
    await add(h, 'A');
    writeConfigDirectory(h.repo, `${WORKFLOW_CONFIG}  delivery: { mode: commit }\n`);
    expect((await queueOf(h)).deliveryMode).toBe('commit');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped');
    expect((await allRuns(h)).map((run) => run.deliveryMode)).toEqual(['commit']);
  });

  it('sends a queue event after delivery.mode is written', async () => {
    const h = await start();
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await add(h, 'A');
    await h.call('config_setting', {
      repository: h.repo,
      path: 'delivery.mode',
      value: 'commit',
      revision: null,
      level: 'global',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queues = events.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    expect(queues.at(-1)?.deliveryMode).toBe('commit');
    await stop(h);
    expect(await ended).toBe('closed');
  });
});

describe('autopilot answers', () => {
  it('answers a question of a specialist and goes on, marking the decision', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}, {}] });
    await h.call('queue_settings', { repository: h.repo, autopilot: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(h, (queue) => queue.runs.length === 0 && queue.items.length === 0);
    expect(done.stop).toBeNull();
    const [created] = await allRuns(h);
    await h.waitFor(created!.id, (run) => run.finished);
    const state = h.running.daemon.state(created!.id);
    const decisions = state.groups.flatMap((group) => group.decisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ question: 'OAuth или пароль?', by: 'autopilot' });
    expect(decisions[0]?.answer).toContain('I agree with your recommendations');
  });

  it('answers with the text of the queue', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await h.call('queue_settings', {
      repository: h.repo,
      autopilot: true,
      autopilotAnswer: 'Делай как проще',
    });
    expect(await queueOf(h)).toMatchObject({ autopilotAnswer: 'Делай как проще' });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs.length === 0 && queue.items.length === 0);
    const [created] = await allRuns(h);
    await h.waitFor(created!.id, (run) => run.finished);
    const decisions = h.running.daemon.state(created!.id).groups.flatMap((g) => g.decisions);
    expect(decisions[0]?.answer).toBe('Делай как проще');
    await h.call('queue_settings', { repository: h.repo, autopilotAnswer: null });
    expect((await queueOf(h)).autopilotAnswer).toBeNull();
  });

  it('waits for a human without the autopilot', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const waiting = await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await queueOf(h)).runs[0]?.problem?.reason).toBe('needs_human');
    expect(waiting.stop).toBeNull();
  });
});
