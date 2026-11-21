import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QueueView, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { CODE_ONLY_CONFIG, git, harness, startRun, until, type Harness } from './harness.ts';
import { add, allRuns, queueOf, start, waitQueue } from './queue-harness.ts';

const worktrees = (h: Harness, runId: string) => join(h.repo, '.aip', 'worktrees', runId);
const refsOf = (h: Harness, runId: string) => git(h.repo, 'for-each-ref', `refs/aip/${runId}/`);

interface Cleaned {
  run: RunView;
  removed: string[];
}

/** A run whose only group failed: the queue stops on it and its worktree is left in place. */
async function failedRun() {
  const h = await start();
  h.script({ code: [{ noReport: true }, {}] });
  await add(h, 'A');
  await h.call('queue_start', { repository: h.repo });
  const stopped = await waitQueue(h, (queue) => queue.stop?.kind === 'problem');
  const runId = (stopped.stop as { run: string }).run;
  return { h, runId };
}

/** A run cancelled while its agent works. */
async function cancelledRun() {
  const h = await start();
  h.script({ code: [{ waitFor: h.gate('a') }, {}] });
  await add(h, 'A');
  await h.call('queue_start', { repository: h.repo });
  const runId = (await waitFor(h, () => allRuns(h)))[0]!.id;
  await h.waitFor(runId, (run) => run.groups.some((group) => group.status === 'running'));
  await h.call('cancel', { runId });
  await h.waitFor(runId, (run) => run.finished);
  return { h, runId };
}

async function waitFor<T>(h: Harness, read: () => Promise<T[]>): Promise<T[]> {
  await until('a run', async () => (await read()).length > 0);
  return read();
}

describe('run_clean', () => {
  it('cleans a cancelled run up and keeps its groups, attempts and record', async () => {
    const { h, runId } = await cancelledRun();
    const before = await h.status(runId);
    expect(before).toMatchObject({ cleanedAt: null, cleanable: true });
    expect(existsSync(worktrees(h, runId))).toBe(true);
    expect(refsOf(h, runId)).not.toBe('');

    const answer = (await h.call('run_clean', { runId })) as Cleaned;
    expect(answer.removed.length).toBeGreaterThan(0);
    expect(answer.run).toMatchObject({ cleanable: false, state: 'cancelled' });
    expect(answer.run.cleanedAt).toEqual(expect.any(Number));
    expect(existsSync(worktrees(h, runId))).toBe(false);
    expect(refsOf(h, runId)).toBe('');

    const after = await h.status(runId);
    expect(after.groups.map((group) => group.status)).toEqual(
      before.groups.map((group) => group.status),
    );
    expect((await h.group(runId, after.groups[0]!.slug)).attempts.length).toBeGreaterThan(0);
    h.open('a');
  });

  it('keeps the time of the first cleanup when asked again', async () => {
    const { h, runId } = await cancelledRun();
    const first = (await h.call('run_clean', { runId })) as Cleaned;
    const second = (await h.call('run_clean', { runId, all: true })) as Cleaned;
    expect(second.removed).toEqual([]);
    expect(second.run.cleanedAt).toBe(first.run.cleanedAt);
    h.open('a');
  });

  it('refuses a run that is still active and an unknown run', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    const runId = (await waitFor(h, () => allRuns(h)))[0]!.id;
    await expect(h.call('run_clean', { runId })).rejects.toThrow(
      'the run is still active; cancel it or wait for it to finish',
    );
    expect(existsSync(worktrees(h, runId))).toBe(true);
    expect((await h.status(runId)).cleanedAt).toBeNull();
    await expect(h.call('run_clean', { runId: 'zzz' })).rejects.toThrow('unknown run');
    h.open('a');
  });

  it('does not let a cleaned run be returned to the queue or retried', async () => {
    const { h, runId } = await failedRun();
    await h.call('run_clean', { runId });
    expect(await h.status(runId)).toMatchObject({ returnable: false, cleanable: false });
    await expect(h.call('queue_return', { runId })).rejects.toThrow('run is cleaned up');
    expect((await queueOf(h)).items).toEqual([]);
    const group = (await h.status(runId)).groups[0]!.slug;
    await expect(h.call('retry', { runId, group })).rejects.toThrow('run is cleaned up');
    expect((await h.status(runId)).groups[0]!.status).toBe('failed');
  });
});

describe('run_clean of a delivered-pending run', () => {
  const branchExists = (h: Harness, branch: string) =>
    git(h.repo, 'branch', '--list', branch) !== '';

  async function mergedRun(h: Harness): Promise<string> {
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'login' }],
    })) as { runId: string };
    await h.waitFor(
      runId,
      (run) =>
        run.finished &&
        run.groups[0]?.diffRevision?.endsWith(git(h.repo, 'rev-parse', run.branch)) === true,
    );
    return runId;
  }

  it('keeps the branch and the patch, and removes the branch with `all`', async () => {
    const h = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    try {
      const runId = await mergedRun(h);
      // the visible branch exists when the delivery publishes it: stand it in here
      const branch = `aip/${runId}`;
      git(h.repo, 'branch', branch, (await h.status(runId)).branch);
      expect(branchExists(h, branch)).toBe(true);
      const before = (await h.call('run_patch', { runId })) as { base64: string };

      await h.call('run_clean', { runId });
      expect(branchExists(h, branch)).toBe(true);
      expect(refsOf(h, runId)).toBe('');
      const after = (await h.call('run_patch', { runId })) as { base64: string };
      expect(after.base64).toBe(before.base64);

      await h.call('run_clean', { runId, all: true });
      expect(branchExists(h, branch)).toBe(false);
      expect(((await h.call('run_patch', { runId })) as { base64: string }).base64).toBe(
        before.base64,
      );
    } finally {
      await h.close();
    }
  });
});

describe('run_clean of a run with a task in the queue', () => {
  it('is refused: the run is cleaned up by removing the task', async () => {
    const { h, runId } = await failedRun();
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    expect(await h.status(runId)).toMatchObject({ cleanable: false });
    await expect(h.call('run_clean', { runId })).rejects.toThrow(
      'run is in the queue; remove its task to clean it up',
    );
    expect((await h.status(runId)).cleanedAt).toBeNull();
    expect(existsSync(worktrees(h, runId))).toBe(true);

    await h.call('queue_remove', { repository: h.repo, item: returned.item });
    expect((await h.status(runId)).cleanedAt).toEqual(expect.any(Number));
  });
});

describe('removing the item of a returned run', () => {
  it('cleans the finished run up and keeps its groups', async () => {
    const { h, runId } = await failedRun();
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    expect(returned.items.find((item) => item.id === returned.item)?.cleansRun).toBe(true);
    expect(existsSync(worktrees(h, runId))).toBe(true);

    await h.call('queue_remove', { repository: h.repo, item: returned.item });
    expect((await queueOf(h)).items).toEqual([]);
    const run = await h.status(runId);
    expect(run.cleanedAt).toEqual(expect.any(Number));
    expect(run.groups[0]!.status).toBe('failed');
    expect(run.returnable).toBe(false);
    expect(existsSync(worktrees(h, runId))).toBe(false);
    expect(refsOf(h, runId)).toBe('');
  });

  it('does not clean anything when a plain task is removed', async () => {
    const { h, runId } = await failedRun();
    const added = await add(h, 'B');
    const item = added.items.find((candidate) => candidate.run === null)!;
    expect(item.cleansRun).toBe(false);
    await h.call('queue_remove', { repository: h.repo, item: item.id });
    expect((await h.status(runId)).cleanedAt).toBeNull();
    expect(existsSync(worktrees(h, runId))).toBe(true);
  });
});
