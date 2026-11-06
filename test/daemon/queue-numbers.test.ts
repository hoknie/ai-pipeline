import { describe, expect, it } from 'vitest';

import type { QueueView, RunQueued } from '../../src/protocol/index.ts';
import { start, queueOf, add, waitQueue, allRuns } from './queue-harness.ts';

describe('task numbers', () => {
  it('numbers the tasks of the repository, keeps the numbers after a restart and on return', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}, {}] });
    const first = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
      title: 'A',
    })) as RunQueued;
    expect(first.number).toBe(1);
    const second = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
      title: 'B',
    })) as RunQueued;
    expect(second.number).toBe(2);
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop?.kind === 'problem');
    const runId = (stopped.stop as { run: string }).run;
    expect((await h.status(runId)).number).toBe(1);

    await h.restart();
    const third = await add(h, 'C');
    expect(third.items.at(-1)?.number).toBe(3);

    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    expect(returned.items[0]).toMatchObject({ id: returned.item, number: 1 });
    expect((await queueOf(h)).items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect((await allRuns(h)).map((run) => run.number)).toEqual([1]);
  });
});
