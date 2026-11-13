import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { settle, POLL_MS, PIPELINE_CONFIG } from './harness.ts';
import { start, stop, queueOf, add, waitQueue, allRuns, WRITE_LIB } from './queue-harness.ts';

describe('queue settings', () => {
  it('starts a new queue with a waiting task when the autopilot is turned on', async () => {
    const h = await start();
    // the run stays running while the test looks at the queue
    h.script({ code: [{ waitFor: h.gate('a') }] });
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
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
    );
    expect(await queueOf(h)).toMatchObject({ autopilot: false, skipFailed: false, parallel: 1 });
  });

  it('keeps an item with an error and goes on when failed runs are skipped', async () => {
    const h = await start();
    await add(h, 'A');
    await add(h, 'B');
    writeConfigDirectory(h.repo, PIPELINE_CONFIG.replace('feature:', 'other:'));
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    const view = await waitQueue(h, (queue) => queue.items.every((item) => item.error !== null));
    expect(view.status).toBe('running');
    expect(view.stop).toBeNull();
    expect(view.items.map((item) => item.error)).toEqual([
      expect.stringContaining('unknown pipeline'),
      expect.stringContaining('unknown pipeline'),
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
    writeConfigDirectory(h.repo, `${PIPELINE_CONFIG}  delivery: { mode: commit }\n`);
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
    const queues = () =>
      events.flatMap((event) =>
        event.event === 'queue' ? [event.queue as unknown as QueueView] : [],
      );
    // the event arrives a little after the call
    const deadline = Date.now() + 10_000;
    while (!queues().some((queue) => queue.deliveryMode === 'commit') && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    expect(queues().at(-1)?.deliveryMode).toBe('commit');
    await stop(h);
    expect(await ended).toBe('closed');
  });
});

describe('autopilot answers', () => {
  it('answers a question of a specialist and goes on, marking the decision', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}, {}] });
    await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const done = await waitQueue(h, (queue) => queue.runs.length === 0 && queue.items.length === 0);
    expect(done.stop).toBeNull();
    const [created] = await allRuns(h);
    await h.waitFor(created!.id, (run) => run.finished);
    const state = h.running.application.services.runs.states.get(created!.id);
    const decisions = state.groups.flatMap((group) => group.decisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ question: 'OAuth или пароль?', by: 'autopilot' });
    expect(decisions[0]?.answer).toContain('I agree with your recommendations');
    const view = await h.status(created!.id);
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]).toMatchObject({ by: 'autopilot', question: 'OAuth или пароль?' });
    expect(view.groups.flatMap((row) => row.decisions.map((d) => d.by))).toEqual(['autopilot']);
  });

  it('answers with the text of the queue', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await h.call('queue_settings', {
      repository: h.repo,
      autoAnswer: true,
      autopilotAnswer: 'Делай как проще',
    });
    expect(await queueOf(h)).toMatchObject({ autopilotAnswer: 'Делай как проще' });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs.length === 0 && queue.items.length === 0);
    const [created] = await allRuns(h);
    await h.waitFor(created!.id, (run) => run.finished);
    const decisions = h.running.application.services.runs.states
      .get(created!.id)
      .groups.flatMap((g) => g.decisions);
    expect(decisions[0]?.answer).toBe('Делай как проще');
    await h.call('queue_settings', { repository: h.repo, autopilotAnswer: null });
    expect((await queueOf(h)).autopilotAnswer).toBeNull();
  });

  it('waits for a human with autopilot on and auto answer off', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await h.call('queue_settings', { repository: h.repo, autopilot: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    await settle(h);
    expect((await queueOf(h)).runs[0]?.problem?.reason).toBe('needs_human');
  });

  it('answers a waiting group when auto answer is turned on', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    const view = await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    expect(view).toMatchObject({ autoAnswer: true, autopilot: false });
    await waitQueue(h, (queue) => queue.runs.length === 0 && queue.items.length === 0);
    const [created] = await allRuns(h);
    await h.waitFor(created!.id, (run) => run.finished);
    const decisions = h.running.application.services.runs.states
      .get(created!.id)
      .groups.flatMap((g) => g.decisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ by: 'autopilot' });
    expect((await queueOf(h)).autopilot).toBe(false);
  });

  it('does not start a stopped queue with a task when auto answer is turned on', async () => {
    const h = await start();
    await add(h, 'A');
    const view = await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    expect(view).toMatchObject({ status: 'stopped', autoAnswer: true, autopilot: false });
  });

  it('waits for a human without the autopilot', async () => {
    const h = await start();
    h.script({ code: [{ verdict: 'needs_human', feedback: 'q' }, {}, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const waiting = await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    await settle(h);
    expect((await queueOf(h)).runs[0]?.problem?.reason).toBe('needs_human');
    expect(waiting.stop).toBeNull();
  });
});
