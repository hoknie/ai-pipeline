import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { QueueView, RunCreated, RunView } from '../../src/protocol/index.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(): Promise<Harness> {
  current = await harness();
  return current;
}

const queueOf = async (h: Harness): Promise<QueueView> =>
  (await h.call('queue', { repository: h.repo })) as QueueView;

async function waitQueue(
  h: Harness,
  done: (queue: QueueView) => boolean,
  timeoutMs = 30_000,
): Promise<QueueView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const queue = await queueOf(h);
    if (done(queue)) return queue;
    if (Date.now() > deadline) throw new Error(`timed out; queue: ${JSON.stringify(queue)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function add(h: Harness, title: string): Promise<string> {
  const view = (await h.call('queue_add', {
    repository: h.repo,
    workflow: 'feature',
    task: 'работа',
    title,
  })) as QueueView & { item: string };
  return view.item;
}

const allRuns = async (h: Harness): Promise<RunView[]> =>
  ((await h.call('status', {})) as RunView[]).sort((a, b) => a.createdAt - b.createdAt);

/** Seconds of the epoch `seconds` from now: a reset time for the fake claude. */
const resetIn = (seconds: number) => Math.ceil(Date.now() / 1000) + seconds;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a usage limit in the queue', () => {
  it('stops the queue at once and burns no tasks, even with skipFailed', async () => {
    const h = await start();
    h.script({ code: [{ usageLimit: { resetsAt: resetIn(3600) } }] });
    for (const title of ['A', 'B', 'C', 'D', 'E']) await add(h, title);
    await h.call('queue_settings', { repository: h.repo, skipFailed: true, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const queue = await waitQueue(h, (view) => view.stop?.kind === 'limit');
    await pause(1000);
    const after = await queueOf(h);
    expect(after.status).toBe('stopped');
    expect(after.stop).toMatchObject({ kind: 'limit', runtime: 'claude', autoResume: true });
    expect(after.skipped).toEqual([]);
    expect(after.items.map((item) => item.title)).toEqual(['C', 'D', 'E']);
    expect(await allRuns(h)).toHaveLength(2);
    expect(queue.items).toHaveLength(3);
  });

  it('lets the group wait for the reset, resumes its session and the queue by itself', async () => {
    const h = await start();
    h.script({ code: [{ usageLimit: { resetsAt: resetIn(2) } }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (view) => view.stop?.kind === 'limit');
    const runId = (stopped.stop as { run: string }).run;
    const waiting = await h.status(runId);
    expect(waiting.state).toBe('active');
    expect(waiting.groups[0]).toMatchObject({ status: 'queued' });
    expect(waiting.groups[0]?.limitUntil).toBeGreaterThan(Date.now() - 1000);
    const done = await h.waitFor(runId, (view) => view.state === 'finished');
    expect(done.groups[0]?.status).toBe('merged');
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { step: string; args: string[] });
    expect(calls.filter((call) => call.step === 'code')[1]?.args).toContain('--resume');
    const resumed = await waitQueue(h, (view) => view.items.length === 0);
    expect(resumed.stop?.kind).not.toBe('limit');
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('fails the group and keeps the queue stopped with onLimit stop', async () => {
    const h = await start();
    h.script({ code: [{ usageLimit: { resetsAt: resetIn(3600) } }] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_settings', { repository: h.repo, onLimit: 'stop', skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    const queue = await waitQueue(h, (view) => view.stop?.kind === 'limit');
    expect(queue.stop).toMatchObject({ autoResume: false });
    const run = await h.waitFor(
      (queue.stop as { run: string }).run,
      (view) => view.state === 'failed',
    );
    expect(run.groups[0]?.reason).toMatch(/^usage limit, resets \d\d:\d\d$/);
    expect(queue.items.map((item) => item.title)).toEqual(['B']);
  });

  it('resumes a queue whose reset passed while the daemon was down', async () => {
    const h = await start();
    h.script({ code: [{ usageLimit: { resetsAt: resetIn(2) } }, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (view) => view.stop?.kind === 'limit');
    await h.restart(() => execSleep(3000));
    const runId = (stopped.stop as { run: string }).run;
    await h.waitFor(runId, (view) => view.state === 'finished');
    expect((await queueOf(h)).stop?.kind).not.toBe('limit');
  });
});

describe('return a run to the queue', () => {
  async function failedRun(h: Harness): Promise<string> {
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const queue = await waitQueue(h, (view) => view.stop?.kind === 'problem');
    return (queue.stop as { run: string }).run;
  }

  it('waits for the start and continues the failed step of the same run', async () => {
    const h = await start();
    const runId = await failedRun(h);
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    expect(returned.items[0]).toMatchObject({ id: returned.item, run: runId });
    expect(returned.items.map((item) => item.title)).toEqual(['A', 'B']);
    expect((await h.status(runId)).groups[0]?.status).toBe('failed');
    await h.call('queue_start', { repository: h.repo });
    await h.waitFor(runId, (view) => view.state === 'finished');
    await waitQueue(h, (view) => view.items.length === 0);
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('retries the run at once with run now and refuses a run of another repository', async () => {
    const h = await start();
    const runId = await failedRun(h);
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    await expect(
      h.call('queue_return', { runId, repository: join(h.repo, '..') }),
    ).rejects.toThrow();
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: returned.item,
    })) as RunCreated;
    expect(created.runId).toBe(runId);
    await h.waitFor(runId, (view) => view.state === 'finished');
    expect((await queueOf(h)).status).toBe('stopped');
  });

  it('gives the item an error when nothing is left to retry', async () => {
    const h = await start();
    const runId = await failedRun(h);
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    await h.call('retry', { runId, group: (await h.status(runId)).groups[0]!.slug });
    await h.waitFor(runId, (view) => view.state === 'finished');
    await expect(
      h.call('queue_run_now', { repository: h.repo, item: returned.item }),
    ).rejects.toThrow('run has no failed or cancelled groups');
  });
});

function execSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
