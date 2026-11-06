import { describe, expect, it } from 'vitest';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatQueue, type QueueView, type RunView } from '../../src/protocol/index.ts';
import { settle, PIPELINE_CONFIG, git, until, type Harness } from './harness.ts';
import { calls } from './control-harness.ts';
import { start, queueOf, add, waitQueue, allRuns } from './queue-harness.ts';

const callsOf = (h: Harness): { step: string; group: string }[] =>
  readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const resetIn = (seconds: number) => Math.ceil(Date.now() / 1000) + seconds;

const SPLIT_CONFIG = PIPELINE_CONFIG.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: coder, max_groups: 3 }\n      steps:',
);

/**
 * A paused run with a failed group: of two groups one fails, the other is stopped by the pause.
 */
async function failedPaused() {
  const h = await start(SPLIT_CONFIG);
  h.script({
    split: [
      {
        split: [
          { title: 'Вход', task: 'вход' },
          { title: 'Выход', task: 'выход' },
        ],
      },
    ],
    'code@Вход': [{ noReport: true }, {}],
    'code@Выход': [{ waitFor: h.gate('a') }, {}],
    review: [{}],
  });
  await add(h, 'A');
  await add(h, 'B');
  await h.call('queue_start', { repository: h.repo });
  const runId = (await allRuns(h))[0]!.id;
  await h.waitFor(runId, (state) => state.groups.some((group) => group.status === 'failed'));
  const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
  const failed = (await h.status(runId)).groups.find((group) => group.status === 'failed')!;
  return { h, runId, view, failed: failed.slug };
}

async function paused() {
  const h = await start();
  h.script({ code: [{ waitFor: h.gate('a') }, {}] });
  await add(h, 'A');
  await add(h, 'B');
  await h.call('queue_start', { repository: h.repo });
  const [a] = await allRuns(h);
  const view = (await h.call('run_pause', { runId: a!.id })) as QueueView & { item: string };
  return { h, runId: a!.id, view };
}

describe('pause a run', () => {
  it('moves a running run to the end of the queue, frees its place and keeps the hold', async () => {
    const { h, runId, view } = await paused();
    expect(view.items.at(-1)).toMatchObject({ id: view.item, run: runId, hold: 'paused' });
    expect(view.runs.map((card) => card.id)).not.toContain(runId);
    const state = (await h.status(runId)) as RunView;
    expect(state).toMatchObject({ hold: 'paused', state: 'paused' });
    h.open('a');
  });

  it('refuses a run that is already paused and an unknown run', async () => {
    const { h, runId } = await paused();
    await expect(h.call('run_pause', { runId })).rejects.toThrow('run is already paused');
    await expect(h.call('run_pause', { runId: 'zzz' })).rejects.toThrow('unknown run');
    h.open('a');
  });

  it('refuses a finished run with nothing to pause', async () => {
    const h = await start();
    h.script({ code: [{}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    await h.waitFor(runId, (state) => state.state === 'finished');
    await expect(h.call('run_pause', { runId })).rejects.toThrow('run has nothing to pause');
  });

  it('refuses to remove the task of an unfinished paused run', async () => {
    const { h, view } = await paused();
    await expect(h.call('queue_remove', { repository: h.repo, item: view.item })).rejects.toThrow(
      'a paused run stays in the queue; continue or cancel it',
    );
    h.open('a');
  });

  it('continues the run with run-now and lifts the hold', async () => {
    const { h, runId, view } = await paused();
    h.open('a');
    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    const queue = await waitQueue(h, (q) => q.items.length === 0 && q.runs.length === 0);
    expect(queue.items).toEqual([]);
    const state = (await h.status(runId)) as RunView;
    expect(state.hold).toBeNull();
    expect(state.state).not.toBe('paused');
  });

  it('shows the hold of the item in the queue view', async () => {
    const { h, runId, view } = await paused();
    const queue = await queueOf(h);
    expect(queue.items.find((item) => item.id === view.item)).toMatchObject({
      run: runId,
      hold: 'paused',
    });
    h.open('a');
  });

  it('lifts the pause of a paused run with a failed group on a direct retry', async () => {
    const { h, runId, view, failed } = await failedPaused();
    await waitQueue(h, (q) => q.items.some((item) => item.run === runId));
    const queue = await queueOf(h);
    expect(queue.items.at(-1)).toMatchObject({ id: view.item, hold: 'paused' });
    await h.call('retry', { runId, group: failed });
    const after = await queueOf(h);
    expect(after.items.map((item) => item.run)).not.toContain(runId);
    expect(after.runs.map((card) => card.id)).toContain(runId);
    expect(((await h.status(runId)) as RunView).hold).toBeNull();
    h.open('a');
  });
});

describe('pause a run: more scenarios', () => {
  it('hands the freed place to the next task', async () => {
    const { h, runId } = await paused();
    const runs = await waitUntilRuns(h, 2);
    const second = runs.find((run) => run.id !== runId)!;
    const queue = await queueOf(h);
    expect(queue.runs.map((card) => card.id)).toEqual([second.id]);
    expect(queue.runs.map((card) => card.id)).not.toContain(runId);
    h.open('a');
  });

  it('keeps the hold after a daemon restart', async () => {
    const { h, runId } = await paused();
    h.open('a');
    await h.restart();
    const state = (await h.status(runId)) as RunView;
    expect(state.hold).toBe('paused');
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.run)).toContain(runId);
  });

  it('cancels a paused run: the item stays; removing it lifts the hold', async () => {
    const { h, runId, view } = await paused();
    await h.call('cancel', { runId });
    const cancelled = (await h.status(runId)) as RunView;
    expect(cancelled).toMatchObject({ hold: 'paused', state: 'paused' });
    expect((await queueOf(h)).items.map((item) => item.id)).toContain(view.item);
    await h.call('queue_remove', { repository: h.repo, item: view.item });
    const after = (await h.status(runId)) as RunView;
    expect(after).toMatchObject({ hold: null, state: 'cancelled' });
    h.open('a');
  });

  it('refuses a direct retry of a group that cannot be retried and keeps the hold', async () => {
    const { h, runId, view } = await paused();
    const state = (await h.status(runId)) as RunView;
    await expect(h.call('retry', { runId, group: state.groups[0]!.slug })).rejects.toThrow();
    const after = (await h.status(runId)) as RunView;
    expect(after.hold).toBe('paused');
    expect((await queueOf(h)).items.map((item) => item.id)).toContain(view.item);
    h.open('a');
  });

  it('continues a paused run in a stopped queue', async () => {
    const { h, runId, view } = await paused();
    await h.call('queue_pause', { repository: h.repo });
    h.open('a');
    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    const state = (await h.status(runId)) as RunView;
    expect(state.hold).toBeNull();
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.runs.map((card) => card.id)).toContain(runId);
    expect(queue.items.map((item) => item.id)).not.toContain(view.item);
  });
});

describe('pause a run: scenarios of the queue', () => {
  it('keeps the stop reason when a run is paused in a stopped queue', async () => {
    const h = await start();
    h.script({ code: [{ usageLimit: { resetsAt: resetIn(3600) } }] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (view) => view.stop?.kind === 'limit');
    const runId = (stopped.stop as { run: string }).run;
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.stop).toEqual(stopped.stop);
    expect(queue.items.at(-1)).toMatchObject({ id: view.item, run: runId, hold: 'paused' });
  });

  it('stops the running step, starts no next one and continues the step in the same session', async () => {
    const h = await start(PIPELINE_CONFIG);
    h.script({
      code: [{ waitFor: h.gate('a') }, { write: { 'lib.ts': 'export const value = 2;\n' } }],
    });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('queue_pause', { repository: h.repo });
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    const slug = (await h.status(runId)).groups[0]!.slug;
    await until('the step is stopped', async () =>
      (await h.group(runId, slug)).attempts.some((attempt) => attempt.status === 'cancelled'),
    );
    await settle(h);
    const after = await h.status(runId);
    expect(after.groups[0]).toMatchObject({ status: 'paused', hold: 'paused', wait: null });
    expect(after.finished).toBe(false);
    const detail = await h.group(runId, slug);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]).toMatchObject({
      status: 'cancelled',
      reason: 'interrupted by a pause',
      interrupting: false,
    });
    expect(callsOf(h).filter((call) => call.step === 'code')).toHaveLength(1);

    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    const done = await h.waitFor(runId, (state) => state.finished);
    expect(done.hold).toBeNull();
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls).toHaveLength(2);
    expect(codeCalls[1]?.args).toContain('--resume');
    expect(callsOf(h).filter((call) => call.step === 'review')).toHaveLength(1);
    const committedValues = () =>
      git(h.repo, 'for-each-ref', '--format=%(refname)', `refs/aip/${runId}/`)
        .split('\n')
        .filter(Boolean)
        .map((ref) => git(h.repo, 'show', `${ref}:lib.ts`));
    await until('the commit of the step', () =>
      committedValues().includes('export const value = 2;'),
    );
  });

  it('shows a paused run with a failed group as `paused <run>`', async () => {
    const { h, runId } = await failedPaused();
    await settle(h);
    const queue = await queueOf(h);
    expect(queue.runs.map((card) => card.id)).not.toContain(runId);
    expect(queue.items.map((item) => item.run)).toContain(runId);
    expect(formatQueue(queue)).toContain(`paused ${runId}`);
    const state = (await h.status(runId)) as RunView;
    expect(state.groups.map((group) => group.status).sort()).toEqual(['failed', 'paused']);
    h.open('a');
  });

  it('does not take the return item of a paused run by advance; run-now continues its step', async () => {
    const h = await start(PIPELINE_CONFIG);
    h.script({ code: [{ waitFor: h.gate('a') }, { waitFor: h.gate('b') }, {}], review: [{}, {}] });
    await add(h, 'A');
    await add(h, 'B');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await allRuns(h))[0]!.id;
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    const slug = (await h.status(runId)).groups[0]!.slug;
    await until('the code step is stopped', async () =>
      (await h.group(runId, slug)).attempts.some((a) => a.status === 'cancelled'),
    );
    h.open('b');
    const second = (await waitUntilRuns(h, 2)).find((run) => run.id !== runId)!;
    await h.waitFor(second.id, (state) => state.finished);
    await settle(h);
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.run)).toEqual([runId]);
    expect(queue.items[0]).toMatchObject({ hold: 'paused' });
    const state = await h.status(runId);
    expect(state.hold).toBe('paused');
    expect((await h.group(runId, slug)).attempts).toHaveLength(1);

    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    const done = await h.waitFor(runId, (s) => s.finished);
    expect(done.hold).toBeNull();
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls.some((call) => call.args.includes('--resume'))).toBe(true);
  });

  it('keeps a paused run and its dependent task waiting with a free place', async () => {
    const h = await start(PIPELINE_CONFIG);
    h.script({ code: [{ waitFor: h.gate('a') }, {}], review: [{}] });
    const first = await add(h, 'A');
    await add(h, 'B', { after: [first.item] });
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('run_pause', { runId });
    const slug = (await h.status(runId)).groups[0]!.slug;
    await until('the code step is stopped', async () =>
      (await h.group(runId, slug)).attempts.some((a) => a.status === 'cancelled'),
    );
    await settle(h);
    await settle(h);
    const detail = await h.group(runId, slug);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]).toMatchObject({
      status: 'cancelled',
      reason: 'interrupted by a pause',
    });
    expect((await h.status(runId)).hold).toBe('paused');
    const queue = await queueOf(h);
    expect(queue.status).toBe('running');
    expect(queue.items).toHaveLength(2);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('continues a paused run with a failed group with run-now: the group is retried and the run holds a place', async () => {
    const { h, runId, view } = await failedPaused();
    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    const state = await h.status(runId);
    expect(state.hold).toBeNull();
    expect(state.groups.map((group) => group.status)).not.toContain('paused');
    const queue = await queueOf(h);
    expect(queue.runs.map((card) => card.id)).toContain(runId);
    expect(queue.items.map((item) => item.id)).not.toContain(view.item);
    h.open('a');
  });
});

describe('pause a run: outside the queue and skipped', () => {
  /** A run of two groups: one failed, so the run is skipped; the other still works. */
  async function skippedRun() {
    const h = await start(SPLIT_CONFIG);
    h.script({
      split: [
        {
          split: [
            { title: 'Вход', task: 'вход' },
            { title: 'Выход', task: 'выход' },
          ],
        },
      ],
      'code@Вход': [{ noReport: true }],
      'code@Выход': [{ waitFor: h.gate('a') }, {}],
    });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.skipped.length === 1);
    const runId = (await allRuns(h))[0]!.id;
    expect((await h.status(runId)).finished).toBe(false);
    return { h, runId };
  }

  it('takes a skipped run out of the skipped list and puts it last with the hold', async () => {
    const { h, runId } = await skippedRun();
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    expect(view.skipped.map((card) => card.id)).not.toContain(runId);
    expect(view.runs.map((card) => card.id)).not.toContain(runId);
    expect(view.items.at(-1)).toMatchObject({ id: view.item, run: runId, hold: 'paused' });
    expect(((await h.status(runId)) as RunView).hold).toBe('paused');
    const queue = await queueOf(h);
    expect(queue.skipped.map((card) => card.id)).not.toContain(runId);
    expect(queue.items.at(-1)).toMatchObject({ run: runId, hold: 'paused' });
  });

  it('pauses an unfinished run that is in no list of the queue', async () => {
    const { h, runId } = await skippedRun();
    await h.call('queue_dismiss', { runId });
    const before = await queueOf(h);
    expect(before.skipped.map((card) => card.id)).not.toContain(runId);
    expect(before.runs.map((card) => card.id)).not.toContain(runId);
    expect(before.items.map((item) => item.run)).not.toContain(runId);
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    expect(view.items.at(-1)).toMatchObject({ id: view.item, run: runId, hold: 'paused' });
    expect(((await h.status(runId)) as RunView).hold).toBe('paused');
  });
});

describe('pause a run: daemon restart', () => {
  const SINGLE = `swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

  it('keeps the hold and the return item after a restart', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    await h.call('queue_pause', { repository: h.repo });
    await h.call('run_pause', { runId });
    await h.restart();
    const state = await h.status(runId);
    expect(state.groups[0]!.status).toBe('paused');
    expect(state.finished).toBe(false);
    expect(state.hold).toBe('paused');
    const queue = await queueOf(h);
    expect(queue.status).toBe('stopped');
    expect(queue.items.map((item) => item.run)).toEqual([runId]);
  });

  it('keeps a paused run on pause after a restart of a running queue with a free place', async () => {
    const h = await start(PIPELINE_CONFIG);
    h.script({ code: [{ waitFor: h.gate('a') }, {}], review: [{}] });
    const first = await add(h, 'A');
    await add(h, 'B', { after: [first.item] });
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('run_pause', { runId });
    const slug = (await h.status(runId)).groups[0]!.slug;
    await until('the code step is stopped', async () =>
      (await h.group(runId, slug)).attempts.some((a) => a.status === 'cancelled'),
    );
    await h.restart();
    await settle(h);
    await settle(h);
    expect((await h.status(runId)).hold).toBe('paused');
    expect((await h.group(runId, slug)).attempts).toHaveLength(1);
    expect(await allRuns(h)).toHaveLength(1);
  });

  it('a continued single-step run finishes without a hold and its item stays gone after a restart', async () => {
    const h = await start(SINGLE);
    h.script({ code: [{ waitFor: h.gate('a') }] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitUntilRuns(h, 1))[0]!.id;
    const view = (await h.call('run_pause', { runId })) as QueueView & { item: string };
    await until('the step is stopped', async () =>
      (await h.group(runId, (await h.status(runId)).groups[0]!.slug)).attempts.some(
        (attempt) => attempt.status === 'cancelled',
      ),
    );
    await h.call('queue_run_now', { repository: h.repo, item: view.item });
    h.open('a');
    const done = await h.waitFor(runId, (state) => state.finished);
    expect(done.hold).toBeNull();
    await h.restart();
    expect(((await h.status(runId)) as RunView).hold).toBeNull();
    const queue = await queueOf(h);
    expect(queue.items.map((item) => item.run)).not.toContain(runId);
  });
});

async function waitUntilRuns(h: Awaited<ReturnType<typeof start>>, count: number) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const runs = await allRuns(h);
    if (runs.length >= count) return runs;
    if (Date.now() > deadline) throw new Error('timed out waiting for the next run');
    await settle(h);
  }
}
