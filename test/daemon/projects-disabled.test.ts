import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RepositoryView } from '../../src/presentation/ipc/contract/index.ts';

import { startRun, type Harness } from './harness.ts';
import { WORKER_QUEUE_CONFIG, add, allRuns, queueOf, start, waitQueue } from './queue-harness.ts';

const slugOf = async (h: Harness): Promise<string> =>
  ((await h.call('repositories', {})) as RepositoryView[]).find((entry) => entry.path === h.repo)!
    .slug;

const disable = (h: Harness, enabled = false) =>
  h.call('repository_update', { path: h.repo, enabled });

describe('a disabled project', () => {
  it('refuses new runs, new tasks and the start of its queue, and takes edits of waiting ones', async () => {
    const h = await start();
    const waiting = await add(h, 'A');
    await disable(h);
    const slug = await slugOf(h);
    const refusal = `project \`${slug}\` is disabled`;
    await expect(
      h.call('run', { repository: h.repo, pipeline: 'feature', task: 'x' }),
    ).rejects.toThrow(refusal);
    await expect(add(h, 'B')).rejects.toThrow(refusal);
    await expect(h.call('queue_start', { repository: h.repo })).rejects.toThrow(refusal);
    await h.call('queue_edit', { repository: h.repo, item: waiting.item, task: 'другая работа' });
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items.map((item) => item.task)).toEqual(['другая работа']);
    // a request to the project does not enable it
    const [entry] = (await h.call('repositories', {})) as RepositoryView[];
    expect(entry!.enabled).toBe(false);
    expect(await allRuns(h)).toEqual([]);
  });

  it('stops its running queue; the run keeps working and the next task does not start', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await h.call('queue_settings', { repository: h.repo, parallel: 1 });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const [first] = await allRuns(h);
    await disable(h);
    expect((await queueOf(h)).status).toBe('stopped');
    h.open('a');
    await h.waitFor(first!.id, (view) => view.finished);
    const queue = await waitQueue(h, (view) => view.runs.length === 0);
    expect(queue.items.map((item) => item.title)).toEqual(['B']);
    expect(await allRuns(h)).toHaveLength(1);
    // enabling does not start the queue
    await disable(h, true);
    expect((await queueOf(h)).status).toBe('stopped');
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('takes the answer to a question of its run', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}] });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'x' });
    const asked = await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    await disable(h);
    await h.call('answer', { runId, group: asked.groups[0]!.slug, answer: 'OAuth' });
    const done = await h.waitFor(runId, (view) => view.finished);
    expect(done.groups[0]?.status).toBe('merged');
  });

  it('refuses a task a specialist adds to its queue', async () => {
    const h = await start(WORKER_QUEUE_CONFIG);
    h.script({
      code: [
        {
          waitFor: h.gate('a'),
          realWorker: true,
          toolCalls: [{ name: 'swarm_queue_add', arguments: { pipeline: 'feature', task: 'ещё' } }],
        },
      ],
    });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'x' });
    await disable(h);
    h.open('a');
    await h.waitFor(runId, (view) => view.finished);
    const [result] = readFileSync(join(h.fakeState, 'tools.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { result: { isError?: boolean; content: { text: string }[] } },
      );
    expect(result?.result.isError).toBe(true);
    expect(result?.result.content[0]?.text).toContain(`project \`${await slugOf(h)}\` is disabled`);
    expect((await queueOf(h)).items).toEqual([]);
  });
});
