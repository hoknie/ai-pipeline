import { describe, expect, it } from 'vitest';

import type { QueueView, RunCreated } from '../../src/protocol/index.ts';
import { until, type Harness } from './harness.ts';
import { start, queueOf, add, waitQueue } from './queue-harness.ts';

/**
 * `parallel: 1`, `skipFailed`: task A fails and is skipped, task B runs and waits at gate `b`.
 * Returns the ids of both runs. The retry of A is the third call of the `code` script.
 */
async function skippedAndRunning(
  h: Harness,
  retry: Record<string, unknown>,
  failB: Record<string, unknown> = {},
): Promise<{ a: string; b: string }> {
  h.script({ code: [{ noReport: true }, { waitFor: h.gate('b'), ...failB }, retry, {}] });
  await h.call('queue_settings', { repository: h.repo, skipFailed: true });
  await add(h, 'A');
  await add(h, 'B');
  await h.call('queue_start', { repository: h.repo });
  const queue = await waitQueue(h, (view) => view.skipped.length === 1 && view.runs.length === 1);
  return { a: queue.skipped[0]!.id, b: queue.runs[0]!.id };
}

const retryOf = async (h: Harness, runId: string) => {
  const view = await h.status(runId);
  return h.call('retry', { runId, group: view.groups[0]!.slug });
};

describe('freezing for a priority run', () => {
  it('freezes the running run when a failed run returns, lets its step finish and continues it in a stopped queue', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') });
    const returned = (await h.call('queue_return', { runId: a })) as QueueView;
    expect(returned.runs.map((run) => run.id)).toEqual([a]);
    expect(returned.runs[0]!.priority).toBe(true);
    expect(returned.items[0]).toMatchObject({ run: b, hold: 'frozen' });
    expect(returned.status).toBe('running');
    expect(await h.status(b)).toMatchObject({ state: 'frozen', hold: 'frozen' });
    await h.call('queue_pause', { repository: h.repo });

    h.open('b');
    const idle = await h.waitFor(b, (view) => view.groups.every((g) => g.status === 'queued'));
    expect(idle.finished).toBe(false);
    expect((await h.group(b, idle.groups[0]!.slug)).attempts).toHaveLength(1);
    expect((await queueOf(h)).items[0]).toMatchObject({ run: b, hold: 'frozen' });

    h.open('a');
    await h.waitFor(a, (view) => view.finished);
    const done = await h.waitFor(b, (view) => view.finished);
    expect(done).toMatchObject({ hold: null, state: 'finished' });
    const queue = await waitQueue(h, (view) => view.runs.length === 0);
    expect(queue).toMatchObject({ status: 'stopped', items: [] });
  });

  it('makes a direct retry of a skipped run priority', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') });
    await retryOf(h, a);
    const queue = await queueOf(h);
    expect(queue.runs.map((run) => run.id)).toEqual([a]);
    expect(queue.runs[0]!.priority).toBe(true);
    expect(queue.skipped).toEqual([]);
    expect(queue.items[0]).toMatchObject({ run: b, hold: 'frozen' });
    h.open('a');
    h.open('b');
    await h.waitFor(b, (view) => view.finished);
  });

  it('keeps a frozen run that failed while finishing its step first in the queue and retries it later', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') }, { noReport: true });
    await h.call('queue_return', { runId: a });
    await h.call('queue_pause', { repository: h.repo });
    h.open('b');
    const failed = await h.waitFor(b, (view) => view.finished);
    expect(failed).toMatchObject({ hold: 'frozen', state: 'frozen' });
    const mid = await queueOf(h);
    expect(mid.items[0]).toMatchObject({ run: b, hold: 'frozen' });
    expect(mid.stop).toBeNull();
    h.open('a');
    const done = await h.waitFor(b, (view) => view.finished && view.state === 'finished');
    expect(done.hold).toBeNull();
    expect((await queueOf(h)).status).toBe('stopped');
  });

  it('lets a frozen run continue before the priority one has gone', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') });
    await h.call('queue_return', { runId: a });
    const frozen = (await queueOf(h)).items[0]!;
    const resumed = (await h.call('queue_run_now', {
      repository: h.repo,
      item: frozen.id,
    })) as RunCreated;
    expect(resumed.runId).toBe(b);
    const queue = await queueOf(h);
    expect(queue.runs.map((run) => run.id).sort()).toEqual([a, b].sort());
    expect(queue.runs.length).toBeGreaterThan(queue.parallel);
    expect(queue.items).toEqual([]);
    expect((await h.status(b)).hold).toBeNull();
    h.open('a');
    h.open('b');
    await h.waitFor(b, (view) => view.finished);
  });

  it('freezes nobody for a run on pause that failed in a full queue', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('p'), noReport: true }, { waitFor: h.gate('b') }, {}] });
    await add(h, 'P');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const p = (await waitQueue(h, (view) => view.runs.length === 1)).runs[0]!.id;
    await h.call('run_pause', { runId: p });
    const full = await waitQueue(h, (view) => view.runs.length === 1 && view.runs[0]!.id !== p);
    const b = full.runs[0]!.id;
    h.open('p');
    await h.waitFor(p, (view) => view.finished);
    const queue = await queueOf(h);
    expect(queue.runs.map((run) => run.id)).toEqual([b]);
    expect(queue.items.at(-1)).toMatchObject({ run: p, hold: 'paused' });
    expect((await h.status(b)).hold).toBeNull();
    expect(queue.freezeCandidate).toBe(b);
    h.open('b');
    await h.waitFor(b, (view) => view.finished);
  });

  it('keeps the frozen run and the priority list after a restart of the daemon', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, {
      verdict: 'needs_human',
      feedback: 'как?',
    });
    await h.call('queue_return', { runId: a });
    await until('the priority run asks', async () => (await h.status(a)).state === 'needs_human');
    await h.restart();
    const queue = await queueOf(h);
    expect(queue.runs.map((run) => run.id)).toEqual([a]);
    expect(queue.runs[0]!.priority).toBe(true);
    expect(queue.items[0]).toMatchObject({ run: b, hold: 'frozen' });
    expect((await h.status(b)).hold).toBe('frozen');
  });

  it('refuses a parent for the item of a returned run, also null', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') });
    await h.call('queue_return', { runId: a });
    const item = (await queueOf(h)).items.find((entry) => entry.run === b)!;
    const catalog = await h.call('tags', {});
    for (const parent of [a, null]) {
      await expect(
        h.call('queue_edit', { repository: h.repo, item: item.id, parent }),
      ).rejects.toThrow('a returned run keeps its own task');
    }
    expect(await h.call('tags', {})).toEqual(catalog);
  });

  it('skips a step of a returned run through its queue item and keeps its task', async () => {
    const h = await start();
    const { a, b } = await skippedAndRunning(h, { waitFor: h.gate('a') });
    await h.call('queue_return', { runId: a });
    const item = (await queueOf(h)).items.find((entry) => entry.run === b)!;
    await h.call('queue_edit', { repository: h.repo, item: item.id, skip: ['review'] });
    expect((await h.status(b)).steps.find((step) => step.id === 'review')?.skipped).toBe(true);
    await h.call('queue_edit', { repository: h.repo, item: item.id, skip: [] });
    expect((await h.status(b)).steps.find((step) => step.id === 'review')?.skipped).toBe(false);
    await expect(
      h.call('queue_edit', { repository: h.repo, item: item.id, task: 'другое' }),
    ).rejects.toThrow('a returned run keeps its own task');
    await expect(
      h.call('queue_edit', {
        repository: h.repo,
        item: item.id,
        skip: ['review'],
        task: 'другое',
      }),
    ).rejects.toThrow('a returned run keeps its own task');
    expect((await h.status(b)).steps.find((step) => step.id === 'review')?.skipped).toBe(false);
    await expect(
      h.call('queue_edit', { repository: h.repo, item: item.id, skip: ['review'], position: 99 }),
    ).rejects.toThrow();
    await expect(
      h.call('queue_edit', {
        repository: h.repo,
        item: item.id,
        skip: ['review'],
        after: ['nonexistent'],
      }),
    ).rejects.toThrow();
    expect((await h.status(b)).steps.find((step) => step.id === 'review')?.skipped).toBe(false);
    await h.call('queue_edit', { repository: h.repo, item: item.id, skip: ['review'] });
    expect((await queueOf(h)).items.find((entry) => entry.run === b)?.skip).toEqual(['review']);
    h.open('a');
    h.open('b');
  });
});
