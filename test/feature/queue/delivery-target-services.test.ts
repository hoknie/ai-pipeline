import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QueueAdvance } from '../../../src/feature/queue/services/advance.ts';
import { QueueProjects } from '../../../src/feature/queue/services/projects.ts';
import { addItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';
import { config } from '../runs/helpers.ts';

function repository(): string {
  const path = mkdtempSync(join(tmpdir(), 'aip-target-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path, stdio: 'ignore' });
  git('init');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'base',
  );
  return path;
}

describe('queue target checks', () => {
  it('passes the target to run creation when an item starts', async () => {
    const root = repository();
    const queue = emptyQueue(root, 1);
    const target = { name: 'new', strategy: 'create' } as const;
    const item = addItem(
      queue,
      { pipeline: 'feature', task: 'a', deliveryBranch: target },
      'q1',
      1,
    );
    const settings = config();
    settings.delivery.auto = true;
    settings.delivery.mode = 'commit';
    const create = vi.fn().mockResolvedValue({ runId: 'r1' });
    const advance = new QueueAdvance({
      store: { lines: { repositoryOf: () => root } },
      config: { load: () => settings, serverSettings: () => ({ enabled: false }) },
      tags: { of: () => [] },
      attachments: { listOf: () => [], bindToRun: () => {} },
      runs: { requests: { create } },
    } as never);
    await advance.createRun(queue, item);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ repository: root, deliveryBranch: target });
  });

  it('rechecks effective delivery settings immediately before creating a run', async () => {
    const root = repository();
    const queue = emptyQueue(root, 1);
    const target = { name: 'new', strategy: 'create' } as const;
    const item = addItem(
      queue,
      { pipeline: 'feature', task: 'a', deliveryBranch: target },
      'q1',
      1,
    );
    const settings = config();
    settings.delivery.auto = false;
    settings.delivery.mode = 'commit';
    const create = vi.fn();
    const advance = new QueueAdvance({
      store: { lines: { repositoryOf: () => root } },
      config: { load: () => settings, serverSettings: () => ({ enabled: false }) },
      runs: { requests: { create } },
    } as never);
    await expect(advance.createRun(queue, item)).rejects.toThrow(/autoDeliver/);
    expect(create).not.toHaveBeenCalled();
    expect(queue.items).toContain(item);
  });

  it.each(['existing', 'create'] as const)(
    'rechecks the %s branch before starting',
    async (strategy) => {
      const root = repository();
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
      if (strategy === 'existing') git('branch', 'feature/target');
      const queue = emptyQueue(root, 1);
      const item = addItem(
        queue,
        { pipeline: 'feature', task: 'a', deliveryBranch: { name: 'feature/target', strategy } },
        'q1',
        1,
      );
      if (strategy === 'existing') git('branch', '-D', 'feature/target');
      else git('branch', 'feature/target');
      const settings = config();
      settings.delivery.auto = true;
      settings.delivery.mode = 'commit';
      const create = vi.fn();
      const advance = new QueueAdvance({
        store: { lines: { repositoryOf: () => root } },
        config: { load: () => settings, serverSettings: () => ({ enabled: false }) },
        runs: { requests: { create } },
      } as never);
      await expect(advance.createRun(queue, item)).rejects.toThrow(/deliveryBranch/);
      expect(create).not.toHaveBeenCalled();
      expect(queue.items).toContain(item);
    },
  );

  it('rejects all projects before insertion if a branch is absent from one', async () => {
    const first = repository();
    const second = repository();
    execFileSync('git', ['branch', 'feature/shared'], { cwd: first, stdio: 'ignore' });
    const queues = new Map([first, second].map((root) => [root, emptyQueue(root, 1)]));
    const settings = config();
    settings.delivery.auto = true;
    settings.delivery.mode = 'commit';
    const transaction = vi.fn();
    const projects = new QueueProjects({
      registry: {
        resolve: async (root: string) => root,
        requireEnabled: () => {},
        entry: (root: string) => ({ slug: root === second ? 'second' : 'first' }),
      },
      config: { load: () => settings, serverSettings: () => ({ enabled: false }) },
      store: { of: (root: string) => queues.get(root), findItem: () => undefined },
      items: { resolveDependencies: () => [], providerFor: () => null, ensureItem: async () => {} },
      tags: { of: () => [] },
      database: { transaction },
      now: () => 1,
    } as never);
    await expect(
      projects.add({
        repositories: [first, second],
        pipeline: 'feature',
        task: 'a',
        deliveryBranch: { name: 'feature/shared', strategy: 'existing' },
      }),
    ).rejects.toThrow(/second/);
    expect(transaction).not.toHaveBeenCalled();
    expect([...queues.values()].every((queue) => queue.items.length === 0)).toBe(true);
  });
});
