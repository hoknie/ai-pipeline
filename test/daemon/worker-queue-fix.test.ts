import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QueueView } from '../../src/presentation/ipc/contract/index.ts';
import { type Harness, PIPELINE_CONFIG, startRun } from './harness.ts';
import { itemById, queueOf, start, waitQueue } from './queue-harness.ts';

/** Both specialists of the pipeline may work with the queue. */
const QUEUE_CONFIG = PIPELINE_CONFIG.replace(
  'coder: { name: Coder }',
  'coder: { name: Coder, queue: true }',
).replace(
  'reviewer: { name: Reviewer, permissions: read }',
  'reviewer: { name: Reviewer, permissions: read, queue: true }',
);

interface Queued {
  step: string;
  name: string;
  queued: { isError?: boolean; content: { text: string }[] };
}

const queuedBy = (h: Harness): Queued[] =>
  readFileSync(join(h.fakeState, 'queued.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Queued);

const textsOf = (h: Harness): string[] =>
  queuedBy(h).map((entry) => entry.queued.content[0]?.text ?? '');

const task = (title: string, extra: Record<string, unknown> = {}) => ({
  name: 'swarm_queue_add',
  arguments: { pipeline: 'feature', task: `implement ${title}`, title, ...extra },
});
const edit = (item: string, fields: Record<string, unknown>) => ({
  name: 'swarm_queue_edit',
  arguments: { item, ...fields },
});
const remove = (item: string) => ({ name: 'swarm_queue_remove', arguments: { item } });

/**
 * A run whose specialists follow `script`. It is started right now from a stopped queue, so the
 * tasks its specialists add wait, and so does every task added before.
 */
async function summary(h: Harness, script: Record<string, unknown>): Promise<string> {
  h.script(script);
  const added = (await h.call('queue_add', {
    repository: h.repo,
    pipeline: 'feature',
    task: 'summary',
    allowDuplicate: true,
  })) as QueueView & { item: string };
  const { runId } = (await h.call('queue_run_now', {
    repository: h.repo,
    item: added.item,
  })) as { runId: string };
  await h.waitFor(runId, (view) => view.finished);
  return runId;
}

const parentOf = (queue: QueueView, id: string): string | undefined =>
  itemById(queue, id)?.links.find((link) => link.kind === 'parent')?.id;

describe('a specialist corrects the tasks its run queued', () => {
  it('is refused a copy with another predecessor and changes the waiting task instead', async () => {
    const h = await start(QUEUE_CONFIG);
    const run = await summary(h, {
      code: [
        {
          realWorker: true,
          queueTools: [
            task('connection'),
            task('skills', { after: ['$1'] }),
            // the mistake: projects must wait for skills
            task('projects', { after: ['$1'] }),
            task('projects', { after: ['$2'] }),
            edit('$3', { after: ['$2'] }),
          ],
        },
      ],
    });
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.title)).toEqual(['connection', 'skills', 'projects']);
    const [, skills, projects] = queue.items;
    expect(projects!.after.map((dependency) => dependency.id)).toEqual([skills!.id]);
    expect(parentOf(queue, projects!.id)).toBe(run);
    const [, , , copy, changed] = queuedBy(h);
    expect(copy!.queued.isError).toBe(true);
    const refusal = copy!.queued.content[0]!.text;
    expect(refusal).toContain(`task #${projects!.number} (${projects!.id})`);
    expect(refusal).toContain('swarm_queue_edit');
    expect(refusal).toContain('swarm_queue_remove');
    expect(changed!.queued.isError).toBeFalsy();
    expect(changed!.queued.content[0]!.text).toContain(`Changed ${projects!.id}`);
  });

  it('removes its task, and the tasks that waited for it no longer do', async () => {
    const h = await start(QUEUE_CONFIG);
    await summary(h, {
      code: [
        {
          realWorker: true,
          queueTools: [task('model'), task('API', { after: ['$1'] }), remove('$1')],
        },
      ],
    });
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.title)).toEqual(['API']);
    expect(queue.items[0]!.after).toEqual([]);
    expect(queue.items[0]!.readiness).toBe('ready');
    expect(textsOf(h)[2]).toContain('Removed');
    // nothing holds the task that waited for the removed one: the queue takes it
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.items.length === 0);
  });

  it('keeps the run as the parent when the links are replaced, and refuses another parent', async () => {
    const h = await start(QUEUE_CONFIG);
    const run = await summary(h, {
      code: [
        {
          queueTools: [
            task('model'),
            task('API'),
            edit('$2', { links: [{ kind: 'blocked_by', target: '$1' }] }),
            edit('$2', { links: [{ kind: 'parent', target: '$1' }] }),
            edit('$2', { title: 'Public API', postponed: true }),
          ],
        },
      ],
    });
    const queue = await queueOf(h);
    const [model, api] = queue.items;
    expect(textsOf(h)[2]).toContain(`Changed ${api!.id}`);
    expect(api!.after.map((dependency) => dependency.id)).toEqual([model!.id]);
    expect(parentOf(queue, api!.id)).toBe(run);
    expect(textsOf(h)[3]).toBe("a specialist's task has its run as the parent");
    // a field a specialist may not change does nothing
    expect(api!.title).toBe('Public API');
    expect(api!.postponed).toBe(false);
  });

  it('lets another step of the same run remove the task', async () => {
    const h = await start(QUEUE_CONFIG);
    await summary(h, {
      code: [{ queueTools: [task('model')] }],
      review: [{ queueTools: [remove('$last')] }],
    });
    expect((await queueOf(h)).items).toEqual([]);
    expect(textsOf(h)[1]).toContain('Removed');
  });
});

describe('a specialist and the tasks of others', () => {
  it('refuses a task of a person, of another run, and one that is not waiting', async () => {
    const h = await start(QUEUE_CONFIG);
    // the task of the first run
    await summary(h, { code: [{ queueTools: [task('from the first run')] }] });
    const foreign = (await queueOf(h)).items[0]!.id;
    const person = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'by a person',
    })) as QueueView & { item: string };
    await summary(h, {
      code: [
        {},
        {
          queueTools: [
            remove(person.item),
            edit(person.item, { title: 'Mine now' }),
            remove(foreign),
            edit('nope', { title: 'x' }),
          ],
        },
      ],
    });
    const texts = textsOf(h).slice(1);
    expect(texts).toEqual([
      `task ${person.item} was not queued by this run`,
      `task ${person.item} was not queued by this run`,
      `task ${foreign} was not queued by this run`,
      'unknown queue item',
    ]);
    const ids = (await queueOf(h)).items.map((item) => item.id);
    expect(ids).toContain(person.item);
    expect(ids).toContain(foreign);
  });

  it('gives a run the task a person made its child', async () => {
    const h = await start(QUEUE_CONFIG);
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const created = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'summary' });
    await h.call('queue_pause', { repository: h.repo });
    const child = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'a child of the run',
      parent: created.runId,
    })) as QueueView & { item: string };
    // the review step starts after this: it reads the script with the id of the child
    h.script({
      code: [{ waitFor: h.gate('code') }],
      review: [{ queueTools: [edit(child.item, { title: 'Taken' })] }],
    });
    h.open('code');
    await h.waitFor(created.runId, (view) => view.finished);
    expect(textsOf(h)[0]).toContain(`Changed ${child.item}`);
    expect(itemById(await queueOf(h), child.item)?.title).toBe('Taken');
  });

  it('refuses a token of no running attempt', async () => {
    const h = await start(QUEUE_CONFIG);
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
    })) as QueueView & { item: string };
    for (const call of [
      h.call('worker_queue_edit', { token: 'nope', item: added.item, title: 'y' }),
      h.call('worker_queue_remove', { token: 'nope', item: added.item }),
    ]) {
      await expect(call).rejects.toThrow('unknown or expired report token');
    }
    expect((await queueOf(h)).items).toHaveLength(1);
  });

  it('gives a specialist without the right to queue no way to remove a task', async () => {
    const h = await start(PIPELINE_CONFIG);
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
    })) as QueueView & { item: string };
    await summary(h, { code: [{ queueTools: [remove(added.item)] }] });
    expect(textsOf(h)[0]).toContain('may not add tasks to the queue');
    expect((await queueOf(h)).items.map((item) => item.id)).toContain(added.item);
  });
});
