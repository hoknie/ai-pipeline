import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type QueueView,
  type RunCreated,
  type RunQueued,
  type RunView,
  type StreamEvent,
} from '../../src/protocol/index.ts';

import { writeConfigDirectory } from '../fixtures/config.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(config = WORKFLOW_CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

const queueOf = async (h: Harness): Promise<QueueView> =>
  (await h.call('queue', { repository: h.repo })) as QueueView;

async function add(h: Harness, task: string, extra: Record<string, unknown> = {}) {
  const view = (await h.call('queue_add', {
    repository: h.repo,
    workflow: 'feature',
    // the fake agent counts its script per group: one task text makes the counter global
    task: 'работа',
    title: task,
    ...extra,
  })) as QueueView & { item: string };
  return view;
}

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

const allRuns = async (h: Harness): Promise<RunView[]> =>
  ((await h.call('status', {})) as RunView[]).sort((a, b) => a.createdAt - b.createdAt);

const WRITE_LIB = { write: { 'lib.ts': 'export const value = 2;\n' } };

describe('queue contents', () => {
  it('starts empty, stopped, with parallel 1', async () => {
    const h = await start();
    expect(await queueOf(h)).toMatchObject({ status: 'stopped', parallel: 1, items: [], runs: [] });
  });

  it('adds without starting, finds the queue from a subdirectory, and keeps the order', async () => {
    const h = await start();
    mkdirSync(join(h.repo, 'app'), { recursive: true });
    await h.call('queue_add', {
      repository: join(h.repo, 'app'),
      workflow: 'feature',
      task: 'работа',
      title: 'A',
    });
    const view = await add(h, 'B');
    await add(h, 'C');
    expect(view.items.map((item) => item.title)).toEqual(['A', 'B']);
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items.map((item) => item.title)).toEqual(['A', 'B', 'C']);
    expect(await allRuns(h)).toEqual([]);
    const moved = (await h.call('queue_edit', {
      repository: h.repo,
      item: queue.items[2]!.id,
      position: 1,
    })) as QueueView;
    expect(moved.items.map((item) => item.title)).toEqual(['C', 'A', 'B']);
    expect(moved.items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('stores a task with groups', async () => {
    const h = await start();
    const view = (await h.call('queue_add', {
      repository: h.repo,
      workflow: 'feature',
      groups: [
        { title: 'Вход', task: 'форма входа' },
        { title: 'Регистрация', task: 'форма регистрации' },
      ],
    })) as QueueView;
    expect(view.items[0]).toMatchObject({ task: null });
    expect(view.items[0]?.groups).toHaveLength(2);
  });

  it('rejects an unknown workflow and leaves the queue unchanged', async () => {
    const h = await start();
    await expect(
      h.call('queue_add', { repository: h.repo, workflow: 'nope', task: 'x' }),
    ).rejects.toThrow('unknown workflow `nope`; known: feature');
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('edits and removes a waiting item, and rejects a missing one', async () => {
    const h = await start();
    const { item } = await add(h, 'A');
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      task: 'A2',
      title: null,
    })) as QueueView;
    expect(edited.items[0]).toMatchObject({ task: 'A2', title: null });
    const removed = (await h.call('queue_remove', { repository: h.repo, item })) as QueueView;
    expect(removed.items).toEqual([]);
    await expect(h.call('queue_remove', { repository: h.repo, item })).rejects.toThrow(
      'unknown queue item',
    );
  });
});

describe('running the queue', () => {
  it('runs one task at a time and gives the next one the delivered result', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, { read: ['lib.ts'] }] });
    await add(h, 'первая');
    await add(h, 'вторая');
    await h.call('queue_start', { repository: h.repo });
    const first = await queueOf(h);
    expect(first.status).toBe('running');
    expect(first.runs).toHaveLength(1);
    expect(first.items).toHaveLength(1);
    const done = await waitQueue(h, (queue) => queue.status === 'stopped');
    expect(done).toMatchObject({ items: [], runs: [] });
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.fromQueue)).toBe(true);
    expect(runs.map((run) => run.state)).toEqual(['finished', 'finished']);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads.at(-1)!).contents['lib.ts']).toBe('export const value = 2;\n');
  });

  it('frees the place at the end of a run when delivery is manual', async () => {
    const h = await start(MANUAL_CONFIG);
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const [runId] = (await queueOf(h)).runs.map((run) => run.id);
    await h.waitFor(runId!, (view) => view.finished);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // delivery.auto is false: the place is free once the run is finished
    const queue = await waitQueue(h, (view) => view.items.length === 0);
    expect(queue.items).toEqual([]);
  });

  it('starts two runs at once with parallel 2', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, { delayMs: 1500 }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await add(h, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const queue = await queueOf(h);
    expect(queue.runs).toHaveLength(2);
    expect(queue.items.map((item) => item.title)).toEqual(['C']);
    await waitQueue(h, (view) => view.status === 'stopped');
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('takes an added task at once when a place is free in a running queue', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 2000 }, { delayMs: 2000 }, {}] });
    await add(h, 'A');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    expect((await queueOf(h)).runs).toHaveLength(1);
    const queue = await add(h, 'B');
    expect(queue.runs).toHaveLength(2);
    expect(queue.items).toEqual([]);
    await waitQueue(h, (view) => view.status === 'stopped');
  });

  it('does not run while paused, and does not interrupt a running run', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 800 }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const paused = (await h.call('queue_pause', { repository: h.repo })) as QueueView;
    expect(paused.status).toBe('stopped');
    const [runId] = paused.runs.map((run) => run.id);
    const final = await h.waitFor(runId!, (view) => view.finished);
    expect(final.state).toBe('finished');
    await new Promise((resolve) => setTimeout(resolve, 600));
    const queue = await queueOf(h);
    expect(queue.items).toHaveLength(1);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('keeps running on a question to a human and goes on after the answer', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const waiting = await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    expect(waiting.status).toBe('running');
    expect(waiting.stop).toBeNull();
    expect(waiting.items).toHaveLength(1);
    const run = waiting.runs[0]!;
    const group = (await h.status(run.id)).groups[0]!.slug;
    await h.call('answer', { runId: run.id, group, answer: 'пароль' });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.stop).toBeNull();
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('takes the next task when started again after a failed run', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.stop).toBeNull();
    expect(await allRuns(h)).toHaveLength(2);
  });

  it('keeps an item first with an error when its workflow disappeared', async () => {
    const h = await start();
    await add(h, 'A');
    writeConfigDirectory(h.repo, WORKFLOW_CONFIG.replace('feature:', 'other:'));
    await h.call('queue_start', { repository: h.repo });
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toMatchObject({ kind: 'item' });
    expect(queue.items[0]?.error).toContain('unknown workflow');
    expect(await allRuns(h)).toEqual([]);
  });

  it('runs an item now over the limit and the run holds a place of the queue', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, { delayMs: 1500 }, {}] });
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await add(h, 'A');
    await add(h, 'B');
    const c = await add(h, 'C');
    const d = await add(h, 'D');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.runs.length === 2);
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: d.item,
    })) as RunCreated;
    const queue = await queueOf(h);
    expect(queue.runs).toHaveLength(3);
    expect(queue.parallel).toBe(2);
    expect(queue.status).toBe('running');
    expect(queue.items.map((item) => item.id)).toEqual([c.item]);
    expect(queue.runs.map((run) => run.id)).toContain(created.runId);
    expect((await h.status(created.runId)).fromQueue).toBe(true);
    await expect(h.call('queue_run_now', { repository: h.repo, item: d.item })).rejects.toThrow(
      'unknown queue item',
    );
    // C starts only when two of the three runs have left their places
    const sizes = new Set<number>([queue.runs.length]);
    await waitQueue(h, (view) => {
      sizes.add(view.runs.length);
      if (view.runs.length >= 3) {
        expect(view.items.map((item) => item.id)).toEqual([c.item]);
      }
      return view.status === 'stopped' && view.items.length === 0;
    });
    expect(Math.max(...sizes)).toBe(3);
    expect(sizes.has(4)).toBe(false);
    expect(await allRuns(h)).toHaveLength(4);
  });

  it('runs an item now in a stopped queue and leaves the queue stopped', async () => {
    const h = await start();
    await add(h, 'A');
    const b = await add(h, 'B');
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: b.item,
    })) as RunCreated;
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(1);
    expect(queue.runs.map((run) => run.id)).toEqual([created.runId]);
  });

  it('stops the queue when a run started now fails', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 3000 }, { noReport: true }] });
    await add(h, 'A');
    await add(h, 'B');
    const c = await add(h, 'C');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.runs.length === 1);
    const now = (await h.call('queue_run_now', {
      repository: h.repo,
      item: c.item,
    })) as RunCreated;
    const stopped = await waitQueue(h, (view) => view.stop !== null);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed', run: now.runId });
  });

  it('restores the queue after the daemon restarts and keeps watching its runs', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 5000 }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs.length === 1);
    await h.restart();
    // the interrupted attempt of A is a new problem: the queue stops, B still waits
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    expect(stopped.items.map((item) => item.title)).toEqual(['B']);
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(
      h,
      (queue) => queue.status === 'stopped' && queue.items.length === 0,
    );
    expect(done.runs).toEqual([]);
    expect(await allRuns(h)).toHaveLength(2);
  });
});

describe('live parallel', () => {
  it('takes waiting tasks at once when parallel grows in a running queue', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, { delayMs: 1500 }, { delayMs: 1500 }] });
    await add(h, 'A');
    await add(h, 'B');
    await add(h, 'C');
    await h.call('queue_start', { repository: h.repo });
    expect((await queueOf(h)).runs).toHaveLength(1);
    const grown = (await h.call('queue_settings', {
      repository: h.repo,
      parallel: 3,
    })) as QueueView;
    expect(grown.parallel).toBe(3);
    expect(grown.runs).toHaveLength(3);
    expect(grown.items).toEqual([]);
    await waitQueue(h, (view) => view.status === 'stopped');
  });

  it('does not interrupt runs when parallel shrinks and holds the next task', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, { delayMs: 1500 }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await add(h, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const shrunk = (await h.call('queue_settings', {
      repository: h.repo,
      parallel: 1,
    })) as QueueView;
    expect(shrunk.runs).toHaveLength(2);
    expect(shrunk.items.map((item) => item.title)).toEqual(['C']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const waiting = await queueOf(h);
    expect(waiting.runs).toHaveLength(2);
    expect(waiting.items).toHaveLength(1);
    await waitQueue(h, (view) => view.status === 'stopped' && view.items.length === 0);
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('changes parallel in a stopped queue without touching the stop reason', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    const changed = (await h.call('queue_settings', {
      repository: h.repo,
      parallel: 3,
    })) as QueueView;
    expect(changed).toMatchObject({ status: 'stopped', parallel: 3, stop: stopped.stop });
    expect(changed.items).toHaveLength(1);
    expect(changed.runs).toHaveLength(stopped.runs.length);
  });

  it('rejects parallel 0 and keeps the queue', async () => {
    const h = await start();
    await expect(h.call('queue_settings', { repository: h.repo, parallel: 0 })).rejects.toThrow();
    expect((await queueOf(h)).parallel).toBe(1);
  });

  it('sends a queue event when the step of a queue run changes, and none without changes', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 600 }] });
    await add(h, 'A');
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.status === 'stopped' && view.runs.length === 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const queues = events.flatMap((event) =>
      event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
    );
    const steps = queues.flatMap((queue) =>
      queue.runs.flatMap((run) => run.active.map((a) => a.step)),
    );
    expect(steps).toContain('code');
    expect(steps).toContain('review');
    const prints = queues.map((queue) => JSON.stringify(queue.runs));
    const runsOnly = queues.filter(
      (queue, index) => index > 0 && prints[index] !== prints[index - 1],
    );
    expect(runsOnly.length).toBeGreaterThan(1);
    const whole = queues.map((queue) => JSON.stringify({ ...queue, updatedAt: 0 }));
    whole.forEach((print, index) => {
      if (index > 0) expect(print).not.toBe(whole[index - 1]);
    });
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});

describe('tasks from a specialist', () => {
  it('adds a task to the queue of the run repository, not of the worktree, and does not start it', async () => {
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
      code: [{ ...WRITE_LIB, queue: { workflow: 'nope', task: 'никуда' } }],
      review: [{ queue: { workflow: 'feature', task: 'Реализовать web-i18n', title: 'web-i18n' } }],
    });
    const created = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      task: 'подвести итоги',
    });
    // a task of a specialist never starts the queue: pause it so the finished run does not take it
    await h.call('queue_pause', { repository: h.repo });
    await h.waitFor(created.runId, (view) => view.finished);
    const queued = readFileSync(join(h.fakeState, 'queued.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            step: string;
            queued: { isError?: boolean; content: { text: string }[] };
          },
      );
    const code = queued.find((entry) => entry.step === 'code')!;
    expect(code.queued.isError).toBe(true);
    expect(code.queued.content[0]?.text).toContain('unknown workflow `nope`');
    expect(queued.find((entry) => entry.step === 'review')?.queued.isError).toBeFalsy();
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      workflow: 'feature',
      task: 'Реализовать web-i18n',
      title: 'web-i18n',
    });
  });
});

describe('automatic delivery per task', () => {
  it('keeps the choice of an item, resets it with null and shows the setting', async () => {
    const h = await start();
    const first = await add(h, 'A', { autoDeliver: false });
    expect(first.autoDeliver).toBe(true);
    expect(first.items[0]?.autoDeliver).toBe(false);
    const second = await add(h, 'B');
    expect(second.items[1]?.autoDeliver).toBeNull();
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item: first.item,
      title: 'A2',
    })) as QueueView;
    expect(edited.items[0]).toMatchObject({ title: 'A2', autoDeliver: false });
    const reset = (await h.call('queue_edit', {
      repository: h.repo,
      item: first.item,
      autoDeliver: null,
    })) as QueueView;
    expect(reset.items[0]?.autoDeliver).toBeNull();
  });

  it('shows delivery.auto of the repository in the queue', async () => {
    const h = await start(MANUAL_CONFIG);
    expect((await queueOf(h)).autoDeliver).toBe(false);
  });

  it('frees the place of a task without auto delivery, which waits for apply', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB, {}] });
    await add(h, 'A', { autoDeliver: false });
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(h, (queue) => queue.status === 'stopped');
    expect(done).toMatchObject({ items: [], runs: [] });
    const runs = await allRuns(h);
    expect(runs.map((run) => run.autoDeliver)).toEqual([false, true]);
    const [manual] = runs;
    const view = await h.waitFor(manual!.id, (run) => run.finished);
    expect(view.groups.map((group) => group.delivery)).toEqual(['pending']);
  });

  it('takes the setting when the task starts, not when it is added', async () => {
    const h = await start();
    await add(h, 'A');
    writeConfigDirectory(h.repo, MANUAL_CONFIG);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped');
    expect((await allRuns(h)).map((run) => run.autoDeliver)).toEqual([false]);
  });

  it('passes the choice of an item to a run started now', async () => {
    const h = await start();
    const { item } = await add(h, 'A', { autoDeliver: false });
    const created = (await h.call('queue_run_now', { repository: h.repo, item })) as RunCreated;
    expect((await h.status(created.runId)).autoDeliver).toBe(false);
    await h.waitFor(created.runId, (run) => run.finished);
  });
});

describe('run goes through the queue', () => {
  const run = (h: Harness, extra: Record<string, unknown> = {}) =>
    h.call('run', {
      repository: h.repo,
      workflow: 'feature',
      task: 'работа',
      ...extra,
    } as never) as Promise<RunQueued>;

  it('starts a stopped empty queue and creates a run of the queue', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }] });
    const queued = await run(h);
    expect(queued.run).not.toBeNull();
    expect(queued.queue.status).toBe('running');
    expect(queued.queue.items).toEqual([]);
    expect(queued.queue.runs.map((entry) => entry.id)).toEqual([queued.run!.runId]);
    expect((await h.status(queued.run!.runId)).fromQueue).toBe(true);
  });

  it('puts the task last when the places are taken and starts it later', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, {}] });
    const first = await run(h);
    await add(h, 'X');
    const second = await run(h);
    expect(first.run).not.toBeNull();
    expect(second.run).toBeNull();
    expect(second.queue.items.at(-1)?.id).toBe(second.item);
    expect(second.queue.items).toHaveLength(2);
    expect(second.queue.runs).toHaveLength(1);
    await waitQueue(h, (view) => view.status === 'stopped' && view.items.length === 0);
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('continues a paused queue: the waiting task goes first, the new one waits', async () => {
    const h = await start();
    h.script({ code: [{ delayMs: 1500 }, {}] });
    const a = await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await h.call('queue_pause', { repository: h.repo });
    const paused = await queueOf(h);
    expect(paused).toMatchObject({ status: 'stopped', stop: null });
    expect(paused.runs).toHaveLength(1);
    const queued = await run(h);
    expect(queued.run).toBeNull();
    expect(queued.queue.status).toBe('running');
    expect(queued.queue.runs).toHaveLength(1);
    expect(queued.queue.items.map((item) => item.id)).toEqual([queued.item]);
    expect(a.item).not.toBe(queued.item);
  });

  it('rejects an unknown workflow and leaves the queue unchanged', async () => {
    const h = await start();
    await expect(run(h, { workflow: 'nope' })).rejects.toThrow('unknown workflow `nope`');
    expect(await queueOf(h)).toMatchObject({ status: 'stopped', items: [], runs: [] });
  });

  it('reports an error of the run creation, keeps the item and stops the queue', async () => {
    const h = await start();
    // the workflow exists, but the run cannot be prepared: the repository has no commits to branch from
    await h.call('queue', { repository: h.repo });
    const { rmSync } = await import('node:fs');
    rmSync(join(h.repo, '.git', 'refs', 'heads', 'main'));
    await expect(run(h)).rejects.toThrow();
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.error).not.toBeNull();
    expect(queue.runs).toEqual([]);
  });
});
