import { execFileSync } from 'node:child_process';
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

describe('skipped steps of a task', () => {
  it('runs the task without the skipped step up to merged', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB] });
    const view = await add(h, 'A', { skip: ['review'] });
    expect(view.items[0]?.skip).toEqual(['review']);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const [created] = await allRuns(h);
    const finished = await h.waitFor(created!.id, (run) => run.finished);
    expect(finished.groups.map((group) => group.status)).toEqual(['merged']);
    const slug = finished.groups[0]!.slug;
    const attempts = (await h.group(created!.id, slug)).attempts.map((attempt) => attempt.stepId);
    expect(attempts).toEqual(['code']);
  });

  it('rejects an unknown step with the list of steps and keeps the queue', async () => {
    const h = await start();
    await expect(
      h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'x', skip: ['deploy'] }),
    ).rejects.toThrow('unknown step `deploy` in skip; steps: code, review');
    await expect(
      h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'x', skip: ['code'] }),
    ).rejects.toThrow('step `review` returns to skipped step `code`');
    await expect(
      h.call('run', {
        repository: h.repo,
        workflow: 'feature',
        task: 'x',
        skip: ['code', 'review'],
      }),
    ).rejects.toThrow('skip leaves no steps');
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('replaces and clears skip when editing and checks the final combination', async () => {
    const h = await start();
    const { item } = await add(h, 'A');
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      skip: ['review'],
    })) as QueueView;
    expect(edited.items[0]?.skip).toEqual(['review']);
    const renamed = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      title: 'B',
    })) as QueueView;
    expect(renamed.items[0]?.skip).toEqual(['review']);
    await expect(
      h.call('queue_edit', { repository: h.repo, item, skip: ['nope'] }),
    ).rejects.toThrow('unknown step `nope`');
    expect((await queueOf(h)).items[0]?.skip).toEqual(['review']);
    const cleared = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      skip: [],
    })) as QueueView;
    expect(cleared.items[0]?.skip).toEqual([]);
  });

  it('refuses to change the workflow to one without the skipped step', async () => {
    const h = await start(
      `${WORKFLOW_CONFIG}    other:\n      steps:\n        - { id: code, specialist: coder }\n`,
    );
    const { item } = await add(h, 'A', { skip: ['review'] });
    await expect(
      h.call('queue_edit', { repository: h.repo, item, workflow: 'other' }),
    ).rejects.toThrow('unknown step `review` in skip');
    const unchanged = (await queueOf(h)).items[0];
    expect(unchanged?.workflow).toBe('feature');
    expect(unchanged?.skip).toEqual(['review']);
    const moved = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      workflow: 'other',
      skip: [],
    })) as QueueView;
    expect(moved.items[0]?.workflow).toBe('other');
    expect(moved.items[0]?.skip).toEqual([]);
  });

  it('puts a task with a step removed from swarm.yaml first with an error and stops the queue', async () => {
    const h = await start();
    await add(h, 'A', { skip: ['review'] });
    writeConfigDirectory(
      h.repo,
      WORKFLOW_CONFIG.replace(
        '        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }\n',
        '',
      ),
    );
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop !== null);
    expect(stopped.stop).toMatchObject({ kind: 'item' });
    expect(stopped.items[0]?.error).toContain('unknown step `review` in skip');
    expect(await allRuns(h)).toEqual([]);
  });

  it('passes skip to a run started now', async () => {
    const h = await start();
    h.script({ code: [WRITE_LIB] });
    const { item } = await add(h, 'A', { skip: ['review'] });
    const created = (await h.call('queue_run_now', { repository: h.repo, item })) as RunCreated;
    const finished = await h.waitFor(created.runId, (run) => run.finished);
    const attempts = (await h.group(created.runId, finished.groups[0]!.slug)).attempts;
    expect(attempts.map((attempt) => attempt.stepId)).toEqual(['code']);
  });
});

const WORKER_QUEUE_CONFIG = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, queue: true }',
);

const itemById = (queue: QueueView, id: string) => queue.items.find((item) => item.id === id);

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
    await h.close();
    current = null;
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
    await h.close();
    current = null;
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
    await h.close();
    current = null;
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
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});

async function run_(h: Harness, title: string, after: string[]): Promise<RunQueued> {
  return (await h.call('run', {
    repository: h.repo,
    workflow: 'feature',
    task: 'работа',
    title,
    after,
  })) as RunQueued;
}

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
      'pass parallel, autopilot, autopilotAnswer or skipFailed',
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
    await h.close();
    current = null;
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

describe('fixed run goes first', () => {
  it('keeps the place of a retried skipped run over the waiting tasks', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}, {}] });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.skipped.length === 1);
    const runId = (await allRuns(h))[0]!.id;
    const view = await h.status(runId);
    await h.call('retry', { runId, group: view.groups[0]!.slug });
    const back = await waitQueue(h, (queue) => queue.skipped.length === 0);
    expect(back.runs.map((run) => run.id)).toContain(runId);
    await waitQueue(h, (queue) => queue.runs.length === 0);
  });
});
