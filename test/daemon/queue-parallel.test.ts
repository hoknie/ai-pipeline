import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type QueueView,
  type RunCreated,
  type RunQueued,
  type StreamEvent,
} from '../../src/protocol/index.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { MANUAL_CONFIG, WORKFLOW_CONFIG, startRun, type Harness } from './harness.ts';
import { start, stop, queueOf, add, waitQueue, allRuns, WRITE_LIB } from './queue-harness.ts';

describe('live parallel', () => {
  it('takes waiting tasks at once when parallel grows in a running queue', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('all') }] });
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
    h.open('all');
    await waitQueue(h, (view) => view.status === 'stopped');
  });

  it('does not interrupt runs when parallel shrinks and holds the next task', async () => {
    const h = await start();
    const hold = { waitFor: h.gate('ab') };
    h.script({ code: [hold, hold, {}] });
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
    // both runs are held: neither is interrupted, and C keeps waiting; the settings call has
    // scheduled already, a short pause only gives a wrong start a chance to show
    await new Promise((resolve) => setTimeout(resolve, 50));
    const waiting = await queueOf(h);
    expect(waiting.runs).toHaveLength(2);
    expect(waiting.items).toHaveLength(1);
    h.open('ab');
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
    h.script({ code: [{ waitFor: h.gate('code') }] });
    await add(h, 'A');
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    const queueEvents = () =>
      events.flatMap((event) =>
        event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
      );
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, () =>
      queueEvents().some((queue) => queue.runs.some((run) => run.active.length > 0)),
    );
    h.open('code');
    await waitQueue(h, () => {
      const last = queueEvents().at(-1);
      return last?.status === 'stopped' && last.runs.length === 0;
    });
    // a moment for events without changes, which must not come
    await new Promise((resolve) => setTimeout(resolve, 50));
    const queues = queueEvents();
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
    await stop(h);
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
    h.script({ code: [{ waitFor: h.gate('never') }] });
    const queued = await run(h);
    expect(queued.run).not.toBeNull();
    expect(queued.queue.status).toBe('running');
    expect(queued.queue.items).toEqual([]);
    expect(queued.queue.runs.map((entry) => entry.id)).toEqual([queued.run!.runId]);
    expect((await h.status(queued.run!.runId)).fromQueue).toBe(true);
  });

  it('puts the task last when the places are taken and starts it later', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('first') }, {}] });
    const first = await run(h);
    await add(h, 'X');
    const second = await run(h);
    expect(first.run).not.toBeNull();
    expect(second.run).toBeNull();
    expect(second.queue.items.at(-1)?.id).toBe(second.item);
    expect(second.queue.items).toHaveLength(2);
    expect(second.queue.runs).toHaveLength(1);
    h.open('first');
    await waitQueue(h, (view) => view.status === 'stopped' && view.items.length === 0);
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('continues a paused queue: the waiting task goes first, the new one waits', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('never') }, {}] });
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
