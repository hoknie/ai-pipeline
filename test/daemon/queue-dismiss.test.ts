import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type QueueView,
  type StreamEvent,
} from '../../src/protocol/index.ts';
import { start, queueOf, add, waitQueue, allRuns } from './queue-harness.ts';

describe('dismiss a skipped run', () => {
  async function skippedRun() {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.skipped.length === 1);
    const runId = (await allRuns(h))[0]!.id;
    return { h, runId };
  }

  it('removes the run from the skipped list and keeps the run', async () => {
    const { h, runId } = await skippedRun();
    const events: StreamEvent[] = [];
    void subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    const view = (await h.call('queue_dismiss', { runId })) as QueueView;
    expect(view.skipped).toEqual([]);
    expect((await queueOf(h)).skipped).toEqual([]);
    expect((await h.status(runId)).state).toBe('failed');
    await waitQueue(h, () =>
      events.some(
        (event) =>
          event.event === 'queue' && (event.queue as unknown as QueueView).skipped.length === 0,
      ),
    );
  });

  it('lets the run be retried afterwards', async () => {
    const { h, runId } = await skippedRun();
    await h.call('queue_dismiss', { runId });
    const view = await h.status(runId);
    await h.call('retry', { runId, group: view.groups[0]!.slug });
    await waitQueue(h, (queue) => queue.runs.some((card) => card.id === runId));
    await waitQueue(h, (queue) => queue.runs.length === 0);
    expect((await queueOf(h)).skipped).toEqual([]);
  });

  it('refuses unknown runs, runs not skipped and other repositories', async () => {
    const { h, runId } = await skippedRun();
    await expect(h.call('queue_dismiss', { runId: 'zzz' })).rejects.toThrow('unknown run');
    await expect(
      h.call('queue_dismiss', { runId, repository: join(h.repo, '..') }),
    ).rejects.toThrow();
    await h.call('queue_dismiss', { runId });
    await expect(h.call('queue_dismiss', { runId })).rejects.toThrow(
      'run is not in the skipped list',
    );
  });
});
