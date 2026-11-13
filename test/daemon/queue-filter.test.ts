import { describe, expect, it } from 'vitest';

import type { QueueView } from '../../src/presentation/ipc/contract/index.ts';
import { CODE_ONLY_CONFIG } from './harness.ts';
import { start, queueOf, add, waitQueue, allRuns, itemById } from './queue-harness.ts';

const TWO_PIPELINES = `${CODE_ONLY_CONFIG}    other:
      steps:
        - { id: code, specialist: coder }
`;

describe('queue take filter', () => {
  it('sets the filter of a stopped queue and marks the items that do not fit', async () => {
    const h = await start(TWO_PIPELINES);
    const a = await add(h, 'A');
    const b = await add(h, 'B', { pipeline: 'other' });
    const view = (await h.call('queue_settings', {
      repository: h.repo,
      filter: { pipelines: ['feature', 'feature'] },
    })) as QueueView;
    expect(view.filter).toEqual({ pipelines: ['feature'], tags: [] });
    expect(itemById(view, a.item)?.filtered).toBe(false);
    expect(itemById(view, b.item)?.filtered).toBe(true);
    expect((await queueOf(h)).filter.pipelines).toEqual(['feature']);
  });

  it('takes only the tasks that fit and stops when nothing fits', async () => {
    const h = await start(TWO_PIPELINES);
    h.script({ code: [{}, {}] });
    await add(h, 'A');
    const b = await add(h, 'B', { pipeline: 'other' });
    await h.call('queue_settings', { repository: h.repo, filter: { pipelines: ['feature'] } });
    await h.call('queue_start', { repository: h.repo });
    const view = await waitQueue(
      h,
      (queue) => queue.items.length === 1 && queue.runs.length === 0 && queue.status === 'stopped',
    );
    expect(view.items.map((item) => item.id)).toEqual([b.item]);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('refuses a filter in a running queue and keeps the other settings', async () => {
    const h = await start(TWO_PIPELINES);
    h.script({ code: [{ waitFor: h.gate('a') }] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await expect(
      h.call('queue_settings', {
        repository: h.repo,
        filter: { pipelines: ['feature'] },
        parallel: 2,
      }),
    ).rejects.toThrow('queue filter can be changed only while the queue is stopped');
    expect(await queueOf(h)).toMatchObject({ parallel: 1, filter: { pipelines: [], tags: [] } });
    h.open('a');
  });

  it('rejects an unknown pipeline or tag and leaves the queue unchanged', async () => {
    const h = await start(TWO_PIPELINES);
    await expect(
      h.call('queue_settings', {
        repository: h.repo,
        filter: { pipelines: ['nope'] },
        skipFailed: true,
      }),
    ).rejects.toThrow(/unknown pipeline `nope`; known: feature, other/);
    await expect(
      h.call('queue_settings', { repository: h.repo, filter: { tags: ['nope'] } }),
    ).rejects.toThrow(/nope/);
    expect(await queueOf(h)).toMatchObject({
      skipFailed: false,
      filter: { pipelines: [], tags: [] },
    });
  });

  it('keeps tag filters by tag id, clears one list at a time, and drops a removed tag', async () => {
    const h = await start(TWO_PIPELINES);
    await h.call('tag_add', { repository: h.repo, name: 'auth' });
    await h.call('tag_add', { repository: h.repo, name: 'v2' });
    const set = (await h.call('queue_settings', {
      repository: h.repo,
      filter: { pipelines: ['feature'], tags: ['auth', 'v2'] },
    })) as QueueView;
    expect(set.filterTags.map((tag) => tag.name)).toEqual(['auth', 'v2']);
    await h.call('tag_remove', { repository: h.repo, tag: 'auth' });
    const after = await queueOf(h);
    expect(after.filter.pipelines).toEqual(['feature']);
    expect(after.filter.tags).toHaveLength(1);
    expect(after.filterTags.map((tag) => tag.name)).toEqual(['v2']);
    const cleared = (await h.call('queue_settings', {
      repository: h.repo,
      filter: { tags: [] },
    })) as QueueView;
    expect(cleared.filter).toEqual({ pipelines: ['feature'], tags: [] });
  });

  it('keeps the filter after the daemon restarts', async () => {
    const h = await start(TWO_PIPELINES);
    await h.call('queue_settings', { repository: h.repo, filter: { pipelines: ['other'] } });
    await h.restart();
    expect((await queueOf(h)).filter.pipelines).toEqual(['other']);
  });

  it('starts a task that does not fit with run now', async () => {
    const h = await start(TWO_PIPELINES);
    h.script({ code: [{}] });
    const b = await add(h, 'B', { pipeline: 'other' });
    await h.call('queue_settings', { repository: h.repo, filter: { pipelines: ['feature'] } });
    await h.call('queue_run_now', { repository: h.repo, item: b.item });
    expect(await allRuns(h)).toHaveLength(1);
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('queues a run that does not fit the filter without starting it', async () => {
    const h = await start(TWO_PIPELINES);
    await h.call('queue_settings', { repository: h.repo, filter: { pipelines: ['feature'] } });
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'other',
      task: 'работа',
    })) as { run: unknown; queue: QueueView; item: string };
    expect(queued.run).toBeNull();
    expect(itemById(queued.queue, queued.item)?.filtered).toBe(true);
    expect(await allRuns(h)).toEqual([]);
  });

  it('rejects a wrong shape of the filter', async () => {
    const h = await start(TWO_PIPELINES);
    await expect(
      h.call('queue_settings', { repository: h.repo, filter: { extra: [] } } as never),
    ).rejects.toThrow();
    await expect(
      h.call('queue_settings', { repository: h.repo, filter: { pipelines: [''] } }),
    ).rejects.toThrow();
  });
});
