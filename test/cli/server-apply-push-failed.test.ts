import { describe, expect, it, vi } from 'vitest';

import type { RunView } from '../../src/presentation/ipc/contract/index.ts';

const calls: string[] = [];
let view: Partial<RunView> = {};

vi.mock('../../src/presentation/cli/context.ts', () => ({
  call: async (_ctx: unknown, method: string) => {
    calls.push(method);
    return view;
  },
}));

const { applyFromServer } = await import('../../src/presentation/cli/commands/server/apply.ts');

const options = { mode: 'worktree' as const, force: false, groups: [] };

describe('aip run apply with a server profile after a failed push', () => {
  it('refuses a stale branch when a later push failed and marks nothing', async () => {
    view = {
      id: 'r1',
      baseCommit: 'abc',
      delivery: { merged: 2, applied: 1 },
      remoteBranch: { branch: 'aip/r1', address: 'github.com/o/r' },
      deliveryStage: { status: 'push_failed', reason: 'rejected' },
      groups: [
        { slug: 'a', status: 'merged', delivery: 'applied' },
        { slug: 'b', status: 'merged', delivery: 'push_failed' },
      ],
    } as unknown as RunView;
    await expect(applyFromServer({} as never, 'r1', options)).rejects.toThrow(
      /not in the remote repository yet.*rejected/,
    );
    expect(calls).not.toContain('run_mark_delivered');
  });

  it('refuses when only a group is in push_failed', async () => {
    view = {
      id: 'r1',
      baseCommit: 'abc',
      delivery: { merged: 1, applied: 0 },
      remoteBranch: { branch: 'aip/r1', address: 'github.com/o/r' },
      deliveryStage: null,
      groups: [{ slug: 'b', status: 'merged', delivery: 'push_failed' }],
    } as unknown as RunView;
    await expect(applyFromServer({} as never, 'r1', options)).rejects.toThrow(
      /not in the remote repository yet/,
    );
    expect(calls).not.toContain('run_mark_delivered');
  });
});
