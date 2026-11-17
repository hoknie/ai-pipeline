import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';
import { PIPELINE_CONFIG, startRun } from './harness.ts';
import {
  WORKER_QUEUE_CONFIG,
  add,
  allRuns,
  itemById,
  queueOf,
  start,
  stop,
  waitQueue,
} from './queue-harness.ts';

describe('links of tasks', () => {
  it('links two waiting tasks, shows both sides and unlinks them', async () => {
    const h = await start();
    try {
      const first = await add(h, 'A');
      const second = await add(h, 'B', { links: [{ kind: 'related', target: first.item }] });
      let queue = await queueOf(h);
      expect(itemById(queue, second.item)?.links).toEqual([
        expect.objectContaining({ kind: 'related', id: first.item }),
      ]);
      expect(itemById(queue, first.item)?.links).toEqual([
        expect.objectContaining({ kind: 'related', id: second.item }),
      ]);
      await h.call('task_link', {
        repository: h.repo,
        source: second.item,
        kind: 'duplicates',
        target: first.item,
      });
      queue = await queueOf(h);
      expect(itemById(queue, first.item)?.linkedBy).toEqual([
        expect.objectContaining({ kind: 'duplicates', id: second.item }),
      ]);
      await h.call('task_unlink', {
        repository: h.repo,
        source: second.item,
        kind: 'duplicates',
        target: first.item,
      });
      queue = await queueOf(h);
      expect(itemById(queue, first.item)?.linkedBy).toEqual([]);
    } finally {
      await stop(h);
    }
  });

  it('rejects links combined with after, self links and parent cycles', async () => {
    const h = await start();
    try {
      const first = await add(h, 'A');
      await expect(
        add(h, 'B', { after: [first.item], links: [{ kind: 'related', target: first.item }] }),
      ).rejects.toThrow('links cannot be combined with after or parent');
      await expect(
        h.call('task_link', {
          repository: h.repo,
          source: first.item,
          kind: 'related',
          target: first.item,
        }),
      ).rejects.toThrow('a task cannot link to itself');
      await expect(
        h.call('queue_edit', {
          repository: h.repo,
          item: first.item,
          links: [{ kind: 'blocked_by', target: first.item }],
        }),
      ).rejects.toThrow('a task cannot link to itself');
      await expect(
        h.call('task_link', {
          repository: h.repo,
          source: first.item,
          kind: 'bogus',
          target: first.item,
        }),
      ).rejects.toThrow('unknown link kind');
      const second = await add(h, 'B', { links: [{ kind: 'parent', target: first.item }] });
      await expect(
        h.call('queue_edit', {
          repository: h.repo,
          item: first.item,
          links: [{ kind: 'parent', target: second.item }],
        }),
      ).rejects.toThrow(`parent cycle: ${first.item} → ${second.item} → ${first.item}`);
    } finally {
      await stop(h);
    }
  });

  it('keeps blocked_by when the item starts and queue_edit after leaves other links', async () => {
    const h = await start();
    try {
      h.script({ code: [{}, {}] });
      const first = await add(h, 'A');
      const second = await add(h, 'B', {
        links: [
          { kind: 'blocked_by', target: first.item },
          { kind: 'related', target: first.item },
        ],
      });
      await h.call('queue_edit', { repository: h.repo, item: second.item, after: [] });
      const queue = await queueOf(h);
      expect(itemById(queue, second.item)?.links.map((link) => link.kind)).toEqual(['related']);
      await h.call('queue_start', { repository: h.repo });
      const done = await waitQueue(h, (q) => q.items.length === 0 && q.runs.length >= 1);
      expect(done.items).toEqual([]);
      const started = (await allRuns(h)).find((r) => r.title === 'B');
      expect(started?.links.map((link) => link.kind).sort()).toEqual(['related']);
    } finally {
      await stop(h);
    }
  });

  it('accepts a waiting item as the parent and tags nothing until it runs', async () => {
    const h = await start();
    try {
      const first = await add(h, 'A');
      const child = await add(h, 'B', { parent: 1 });
      const queue = await queueOf(h);
      expect(itemById(queue, child.item)?.links).toEqual([
        expect.objectContaining({ kind: 'parent', id: first.item }),
      ]);
      expect(itemById(queue, first.item)?.linkedBy).toEqual([
        expect.objectContaining({ kind: 'parent', id: child.item }),
      ]);
    } finally {
      await stop(h);
    }
  });

  it('unlinks related from the other side and ignores a link that is not there', async () => {
    const h = await start();
    try {
      const first = await add(h, 'A');
      const second = await add(h, 'B', { links: [{ kind: 'related', target: first.item }] });
      await h.call('task_unlink', {
        repository: h.repo,
        source: first.item,
        kind: 'related',
        target: second.item,
      });
      let queue = await queueOf(h);
      expect(itemById(queue, second.item)?.links).toEqual([]);
      await h.call('task_unlink', {
        repository: h.repo,
        source: first.item,
        kind: 'parent',
        target: second.item,
      });
      queue = await queueOf(h);
      expect(itemById(queue, first.item)?.links).toEqual([]);
    } finally {
      await stop(h);
    }
  });

  it('moves the links of an item to its run and shows the children of the run', async () => {
    const h = await start();
    try {
      h.script({ code: [{ waitFor: h.gate('a') }, {}, {}] });
      const first = await add(h, 'A');
      const child = await add(h, 'B', { links: [{ kind: 'parent', target: first.item }] });
      const other = await add(h, 'C', { links: [{ kind: 'related', target: first.item }] });
      await h.call('queue_start', { repository: h.repo });
      const queue = await waitQueue(h, (q) => q.runs.length >= 1);
      const runId = queue.runs[0]!.id;
      const runs = await allRuns(h);
      const view = runs.find((r) => r.id === runId);
      expect(view?.linkedBy.filter((l) => l.kind === 'parent')).toEqual([
        expect.objectContaining({ id: child.item }),
      ]);
      expect(view?.links.map((l) => l.id)).toEqual(expect.arrayContaining([other.item]));
      h.open('a');
    } finally {
      await stop(h);
    }
  });

  it('keeps the links of a returned item whose removal is refused', async () => {
    const h = await start(PIPELINE_CONFIG);
    try {
      h.script({
        code: [{ noReport: true }, { waitFor: h.gate('b') }, { waitFor: h.gate('a') }, {}],
      });
      await h.call('queue_settings', { repository: h.repo, skipFailed: true });
      await add(h, 'A');
      await add(h, 'B');
      await h.call('queue_start', { repository: h.repo });
      const skipped = await waitQueue(h, (q) => q.skipped.length === 1 && q.runs.length === 1);
      await h.call('queue_return', { runId: skipped.skipped[0]!.id });
      const returned = (await queueOf(h)).items[0]!;
      expect(returned.hold).toBe('frozen');
      const note = await add(h, 'N', { links: [{ kind: 'related', target: returned.id }] });
      await expect(
        h.call('queue_remove', { repository: h.repo, item: returned.id }),
      ).rejects.toThrow('stays in the queue');
      const queue = await queueOf(h);
      expect(itemById(queue, note.item)?.links).toEqual([
        expect.objectContaining({ kind: 'related' }),
      ]);
      h.open('a');
      h.open('b');
    } finally {
      await stop(h);
    }
  });

  it('changes blocked_by of a returned run through its return item', async () => {
    const h = await start(PIPELINE_CONFIG);
    try {
      h.script({
        code: [{ noReport: true }, { waitFor: h.gate('b') }, { waitFor: h.gate('a') }, {}],
      });
      await h.call('queue_settings', { repository: h.repo, skipFailed: true });
      await add(h, 'A');
      await add(h, 'B');
      await h.call('queue_start', { repository: h.repo });
      const skipped = await waitQueue(h, (q) => q.skipped.length === 1 && q.runs.length === 1);
      await h.call('queue_return', { runId: skipped.skipped[0]!.id });
      const runId = (await queueOf(h)).items[0]!.run!;
      const blocker = await add(h, 'C');
      await h.call('task_link', {
        repository: h.repo,
        source: runId,
        kind: 'blocked_by',
        target: blocker.item,
      });
      let returned = (await queueOf(h)).items.find((item) => item.run === runId)!;
      expect(returned.links).toEqual([
        expect.objectContaining({ kind: 'blocked_by', id: blocker.item }),
      ]);
      const view = () => allRuns(h).then((runs) => runs.find((run) => run.id === runId)!);
      expect((await view()).links).toEqual([
        expect.objectContaining({ kind: 'blocked_by', id: blocker.item }),
      ]);
      await h.call('task_unlink', {
        repository: h.repo,
        source: runId,
        kind: 'blocked_by',
        target: blocker.item,
      });
      returned = (await queueOf(h)).items.find((item) => item.run === runId)!;
      expect(returned.links).toEqual([]);
      expect((await view()).links).toEqual([]);
      h.open('a');
      h.open('b');
    } finally {
      await stop(h);
    }
  });

  it('removes blocked_by that a returned run kept from before its start', async () => {
    const h = await start(PIPELINE_CONFIG);
    try {
      h.script({ code: [{}, { noReport: true }, { waitFor: h.gate('b') }, {}] });
      await h.call('queue_settings', { repository: h.repo, skipFailed: true });
      const first = await add(h, 'A');
      await add(h, 'B', { after: [first.item] });
      await h.call('queue_start', { repository: h.repo });
      const skipped = await waitQueue(h, (q) => q.skipped.length === 1);
      await h.call('queue_return', { runId: skipped.skipped[0]!.id });
      const runId = (await queueOf(h)).items[0]!.run!;
      const view = () => allRuns(h).then((runs) => runs.find((run) => run.id === runId)!);
      const link = (await view()).links.find((l) => l.kind === 'blocked_by');
      expect(link).toBeDefined();
      await h.call('task_unlink', {
        repository: h.repo,
        source: runId,
        kind: 'blocked_by',
        target: link!.id,
      });
      expect((await view()).links.filter((l) => l.kind === 'blocked_by')).toEqual([]);
      h.open('a');
      h.open('b');
    } finally {
      await stop(h);
    }
  });

  it('gives a task of a specialist its run as the parent and refuses a parent link', async () => {
    const h = await start(WORKER_QUEUE_CONFIG);
    try {
      h.script({
        code: [
          {
            queueChain: [
              {
                pipeline: 'feature',
                task: 'model',
                title: 'ok',
                links: [{ kind: 'related', target: 'nope' }],
              },
              { pipeline: 'feature', task: 'API', title: 'plain' },
              {
                pipeline: 'feature',
                task: 'bad',
                title: 'bad',
                links: [{ kind: 'parent', target: 'r1' }],
              },
            ],
          },
        ],
      });
      const created = await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        task: 'summary',
      });
      await h.call('queue_pause', { repository: h.repo });
      await h.waitFor(created.runId, (view) => view.finished);
      const queue = await queueOf(h);
      expect(queue.items.map((item) => item.title)).toEqual(['plain']);
      expect(queue.items[0]!.links).toEqual([
        expect.objectContaining({ kind: 'parent', id: created.runId }),
      ]);
    } finally {
      await stop(h);
    }
  });

  it('sends the queue and run events after task_link', async () => {
    const h = await start();
    try {
      h.script({ code: [{}, {}] });
      const first = await add(h, 'A');
      const second = await add(h, 'B');
      const events: StreamEvent[] = [];
      const ended = subscribe(h.socket, (line) =>
        events.push(streamEventSchema.parse(JSON.parse(line))),
      );
      await h.call('task_link', {
        repository: h.repo,
        source: second.item,
        kind: 'related',
        target: first.item,
      });
      await waitQueue(h, () =>
        events.some(
          (event) =>
            event.event === 'queue' &&
            (event.queue as unknown as QueueView).items.some((item) => item.links.length > 0),
        ),
      );
      await stop(h);
      expect(await ended).toBe('closed');
    } finally {
      await stop(h);
    }
  });

  it('keeps links over a daemon restart', async () => {
    const h = await start();
    try {
      const first = await add(h, 'A');
      const second = await add(h, 'B', { links: [{ kind: 'parent', target: first.item }] });
      await h.restart();
      const queue = await queueOf(h);
      expect(itemById(queue, second.item)?.links).toEqual([
        expect.objectContaining({ kind: 'parent', id: first.item }),
      ]);
      expect(itemById(queue, first.item)?.linkedBy).toHaveLength(1);
    } finally {
      await stop(h);
    }
  });
});
