import { afterEach, describe, expect, it } from 'vitest';

import { databasePath } from '../../src/platform/paths/index.ts';
import { requestSchema } from '../../src/presentation/ipc/contract/index.ts';
import { openStorage } from '../feature/storage.ts';
import { run } from '../feature/runs/helpers.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

interface Page {
  runs: { id: string }[];
  next: string | null;
}

describe('finished_runs', () => {
  it('defaults the limit and bounds it', () => {
    const parsed = requestSchema.parse({ method: 'finished_runs', params: {} });
    expect(parsed.method === 'finished_runs' && parsed.params.limit).toBe(15);
    expect(requestSchema.safeParse({ method: 'finished_runs', params: { limit: 0 } }).success).toBe(
      false,
    );
    expect(
      requestSchema.safeParse({ method: 'finished_runs', params: { limit: 101 } }).success,
    ).toBe(false);
  });

  it('takes an absolute repository path only', () => {
    const parse = (repository: string) =>
      requestSchema.safeParse({ method: 'finished_runs', params: { repository } });
    expect(parse('/work/app').success).toBe(true);
    const relative = parse('work/app');
    expect(relative.success).toBe(false);
    expect(JSON.stringify(relative.error?.issues)).toContain('repository');
    expect(parse('').success).toBe(false);
  });

  it('pages the runs of one repository', async () => {
    const h = (current = await harness());
    await h.restart(() => {
      const store = openStorage(databasePath(h.state));
      for (let index = 1; index <= 5; index += 1) {
        const state = run(1, { id: `run00000000${index}`, now: index * 10 });
        state.run.finishedAt = index * 10 + 1;
        state.run.repository = index % 2 === 0 ? '/other' : '/repo';
        store.runs.saveRun(state);
      }
      store.database.close();
    });
    const first = (await h.call('finished_runs', { limit: 2, repository: '/repo' })) as Page;
    expect(first.runs.map((view) => view.id)).toEqual(['run000000005', 'run000000003']);
    const second = (await h.call('finished_runs', {
      limit: 2,
      before: first.next!,
      repository: '/repo',
    })) as Page;
    expect(second.runs.map((view) => view.id)).toEqual(['run000000001']);
    expect(second.next).toBeNull();
    const all = (await h.call('finished_runs', { limit: 5 })) as Page;
    expect(all.runs).toHaveLength(5);
  });

  it('returns pages by cursor and rejects a garbled cursor', async () => {
    const h = (current = await harness());
    await h.restart(() => {
      const store = openStorage(databasePath(h.state));
      for (let index = 1; index <= 5; index += 1) {
        const state = run(1, { id: `run00000000${index}`, now: index * 10 });
        state.run.finishedAt = index * 10 + 1;
        store.runs.saveRun(state);
      }
      store.database.close();
    });
    const first = (await h.call('finished_runs', { limit: 2 })) as Page;
    expect(first.runs.map((view) => view.id)).toEqual(['run000000005', 'run000000004']);
    expect(first.next).not.toBeNull();
    const second = (await h.call('finished_runs', { limit: 2, before: first.next! })) as Page;
    expect(second.runs.map((view) => view.id)).toEqual(['run000000003', 'run000000002']);
    const third = (await h.call('finished_runs', { limit: 2, before: second.next! })) as Page;
    expect(third.runs.map((view) => view.id)).toEqual(['run000000001']);
    expect(third.next).toBeNull();
    await expect(h.call('finished_runs', { limit: 2, before: 'garbage' })).rejects.toThrow(
      /before/,
    );
  });
});
