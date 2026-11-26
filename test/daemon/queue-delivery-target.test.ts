import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { RunQueued } from '../../src/presentation/ipc/contract/index.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { CODE_ONLY_CONFIG } from './harness.ts';
import { add, allRuns, queueOf, start } from './queue-harness.ts';

describe('queued delivery target at start', () => {
  it('run now persists the target and the actual source in the new run', async () => {
    const h = await start();
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: h.repo, encoding: 'utf8' }).trim();
    const sourceCommit = git('rev-parse', 'HEAD');
    const sourceBranch = git('symbolic-ref', '--short', 'HEAD');
    const target = { name: 'feature/target', strategy: 'create' } as const;
    const result = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'work',
      autoDeliver: true,
      deliveryMode: 'commit',
      deliveryBranch: target,
    })) as RunQueued;
    expect(result.run).not.toBeNull();
    const db = new DatabaseSync(join(h.state, 'aip.db'), { readOnly: true });
    try {
      expect(
        db
          .prepare(
            'SELECT delivery_branch_json, source_commit, source_branch FROM runs WHERE id = ?',
          )
          .get(result.run!.runId),
      ).toMatchObject({
        delivery_branch_json: JSON.stringify(target),
        source_commit: sourceCommit,
        source_branch: sourceBranch,
      });
    } finally {
      db.close();
    }
  });

  it('keeps the item when project delivery settings change before start', async () => {
    const config = `${CODE_ONLY_CONFIG}  delivery: { auto: true, mode: commit }\n`;
    const h = await start(config);
    const { item } = await add(h, 'target', {
      deliveryBranch: { name: 'feature/target', strategy: 'create' },
    });
    writeConfigDirectory(h.repo, `${CODE_ONLY_CONFIG}  delivery: { auto: true, mode: worktree }\n`);
    await h.call('queue_start', { repository: h.repo });
    expect(await queueOf(h)).toMatchObject({
      status: 'stopped',
      items: [{ id: item, error: expect.stringMatching(/deliveryBranch/) }],
    });
    expect(await allRuns(h)).toEqual([]);
  });

  it.each(['existing', 'create'] as const)(
    'keeps the item with an error when the %s branch changes after enqueue',
    async (strategy) => {
      const h = await start();
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: h.repo, stdio: 'ignore' });
      if (strategy === 'existing') git('branch', 'feature/target');
      const { item } = await add(h, 'target', {
        autoDeliver: true,
        deliveryMode: 'commit',
        deliveryBranch: { name: 'feature/target', strategy },
      });
      if (strategy === 'existing') git('branch', '-D', 'feature/target');
      else git('branch', 'feature/target');
      await h.call('queue_start', { repository: h.repo });
      const queue = await queueOf(h);
      expect(queue.status).toBe('stopped');
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({
        id: item,
        deliveryBranch: { name: 'feature/target', strategy },
        error: expect.stringMatching(/deliveryBranch/),
      });
      expect(await allRuns(h)).toEqual([]);
      await h.restart();
      expect((await queueOf(h)).items[0]).toMatchObject({
        id: item,
        error: expect.stringMatching(/deliveryBranch/),
      });
    },
  );
});
