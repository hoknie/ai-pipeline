import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DeliverService } from '../../../src/feature/delivery/services/deliver.ts';
import { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';
import { type RunState, SPLIT_GROUP, newGroup } from '../../../src/feature/runs/types/index.ts';
import { run } from '../runs/helpers.ts';

type Request = { kind: string; files?: string[] };

function service(
  serverMode: boolean,
  mode: 'worktree' | 'commit' | 'branch',
  state: RunState = run(1, { deliveryMode: mode }),
) {
  const config = new ConfigService({ environment: {} });
  config.serverSettings = () => ({ enabled: serverMode }) as never;
  const events: string[] = [];
  const received: Request[] = [];
  return {
    state,
    events,
    received,
    deliver: new DeliverService({
      config,
      states: { get: () => state } as never,
      engine: {
        serial: (work: () => Promise<unknown>) => work(),
        apply: async (_state: unknown, event: Request) => {
          events.push(event.kind);
          received.push(event);
        },
      } as never,
    }),
  };
}

describe('a request to deliver in the server mode', () => {
  it.each(['worktree', 'commit'] as const)('is refused for a run in the %s mode', async (mode) => {
    const { deliver, events } = service(true, mode);
    await expect(deliver.deliver({ runId: 'run000000001' })).rejects.toThrow(/aip run apply/);
    expect(events).toEqual([]);
  });

  it('goes to the machine for a branch run', async () => {
    const { deliver, events } = service(true, 'branch');
    await deliver.deliver({ runId: 'run000000001' });
    expect(events).toEqual(['deliver_requested']);
  });

  it('is not checked in the local mode', async () => {
    const { deliver, events } = service(false, 'worktree');
    await deliver.deliver({ runId: 'run000000001' });
    expect(events).toEqual(['deliver_requested']);
  });
});

describe('the files of a delivery request', () => {
  /** A repository with a base commit, the commit of the split and the commit of a group. */
  function repository(): { repo: string; split: string; group: string } {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'aip-delivery-files-')));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('config', 'maintenance.auto', 'false');
    writeFileSync(join(repo, 'lib.ts'), 'export const value = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    mkdirSync(join(repo, 'openspec', 'changes', 'x'), { recursive: true });
    writeFileSync(join(repo, 'openspec', 'changes', 'x', 'tasks.md'), 'tasks\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'split');
    const split = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'lib.ts'), 'export const value = 2;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'group');
    return { repo, split, group: git('rev-parse', 'HEAD') };
  }

  function deliveredRun(repo: string, split: string, group: string): RunState {
    const state = run(1);
    state.run.repository = repo;
    state.split = newGroup(SPLIT_GROUP, 'split', 'split the task', 0);
    state.split.mergeCommit = split;
    state.groups[0]!.status = 'merged';
    state.groups[0]!.mergeCommit = group;
    return state;
  }

  it('names the files of the split result first, then the files of the groups', async () => {
    const { repo, split, group } = repository();
    const { deliver, received } = service(false, 'worktree', deliveredRun(repo, split, group));
    await deliver.deliver({ runId: 'run000000001' });
    expect(received).toEqual([
      expect.objectContaining({
        kind: 'deliver_requested',
        files: ['openspec/changes/x/tasks.md', 'lib.ts'],
      }),
    ]);
  });

  it('leaves the delivered split result out of a later request', async () => {
    const { repo, split, group } = repository();
    const state = deliveredRun(repo, split, group);
    state.split!.delivery.state = 'applied';
    const { deliver, received } = service(false, 'worktree', state);
    await deliver.deliver({ runId: 'run000000001' });
    expect(received).toEqual([
      expect.objectContaining({ kind: 'deliver_requested', files: ['lib.ts'] }),
    ]);
  });
});
