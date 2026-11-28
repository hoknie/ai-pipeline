import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Database } from '../../../src/platform/sqlite/index.ts';
import { ProbeAdmissionRepository } from '../../../src/feature/runs/repositories/index.ts';
import { PROBE_LIMITS } from '../../../src/feature/runs/types/index.ts';

const HOUR = 60 * 60 * 1000;

describe('the admissions of the probe budget', () => {
  it('takes the places of a task and refuses the rest with the reason, writing nothing', () => {
    const database = new Database(':memory:');
    const admissions = new ProbeAdmissionRepository(database, PROBE_LIMITS);
    admissions.reserve({ id: 'exp1', rootRunId: 'task', runs: 10, now: 1000 });
    expect(() => admissions.reserve({ id: 'exp2', rootRunId: 'task', runs: 3, now: 2000 })).toThrow(
      'the probe budget of the task is exhausted: limit 12, used 10, requested 3',
    );
    const rows = () =>
      database
        .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions ORDER BY id')
        .all();
    expect(rows()).toEqual([{ id: 'exp1', root: 'task', runs: 10 }]);
    database.close();
  });

  it('gives the last place to exactly one of two competing requests', () => {
    const database = new Database(':memory:');
    const admissions = new ProbeAdmissionRepository(database, PROBE_LIMITS);
    admissions.reserve({ id: 'exp1', rootRunId: 'task', runs: 11, now: 1000 });
    admissions.reserve({ id: 'probe1', rootRunId: 'task', runs: 1, now: 2000 });
    expect(() =>
      admissions.reserve({ id: 'probe2', rootRunId: 'task', runs: 1, now: 3000 }),
    ).toThrow('limit 12, used 12, requested 1');
    const count = database.prepare('SELECT COUNT(*) AS n FROM probe_admissions').get() as {
      n: number;
    };
    expect(count.n).toBe(2);
    database.close();
  });

  it('counts the places of every task in the window, and refuses by the window when the tasks differ', () => {
    const database = new Database(':memory:');
    const admissions = new ProbeAdmissionRepository(database, PROBE_LIMITS);
    const now = 100 * HOUR;
    admissions.reserve({ id: 'a', rootRunId: 'task-a', runs: 12, now: now - 23 * HOUR });
    admissions.reserve({ id: 'b', rootRunId: 'task-b', runs: 12, now: now - HOUR });
    // The task limit of task-c is untouched, the window is full.
    expect(() => admissions.reserve({ id: 'c', rootRunId: 'task-c', runs: 1, now })).toThrow(
      'the probe budget of the 24h window is exhausted: limit 24, used 24, requested 1',
    );
    // An admission on the closing edge of the window counts no more; the one a moment inside does.
    admissions.restore({ id: 'edge', rootRunId: 'task-d', runs: 12, now: now - 24 * HOUR });
    admissions.restore({ id: 'inside', rootRunId: 'task-d', runs: 12, now: now - 24 * HOUR + 1 });
    expect(() => admissions.reserve({ id: 'e', rootRunId: 'task-e', runs: 1, now })).toThrow(
      'the probe budget of the 24h window is exhausted: limit 24, used 36, requested 1',
    );
    database.close();
  });

  it('keeps the remaining places of a task when the database closes and opens again', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'aip-probe-')), 'aip.sqlite');
    const first = new Database(path);
    const admissions = new ProbeAdmissionRepository(first, PROBE_LIMITS);
    admissions.reserve({ id: 'exp1', rootRunId: 'task', runs: 9, now: 1000 });
    first.close();
    const second = new Database(path);
    const reopened = new ProbeAdmissionRepository(second, PROBE_LIMITS);
    reopened.reserve({ id: 'probe1', rootRunId: 'task', runs: 3, now: 2000 });
    expect(() => reopened.reserve({ id: 'probe2', rootRunId: 'task', runs: 1, now: 3000 })).toThrow(
      'limit 12, used 12, requested 1',
    );
    second.close();
  });

  it('writes the reservation of an admitted plan again without a check, by id once', () => {
    const database = new Database(':memory:');
    const admissions = new ProbeAdmissionRepository(database, PROBE_LIMITS);
    // An old plan above today's limits: the restore accepts it as it was.
    admissions.restore({ id: 'pr-old', rootRunId: 'task', runs: 40, now: 1000 });
    admissions.restore({ id: 'pr-old', rootRunId: 'task', runs: 40, now: 1000 });
    const rows = database
      .prepare('SELECT id, runs FROM probe_admissions WHERE root_run_id = ?')
      .all('task') as { id: string; runs: number }[];
    expect(rows).toEqual([{ id: 'pr-old', runs: 40 }]);
    // The task of the old plan is over the limit: the next request hears it from its places.
    expect(() => admissions.reserve({ id: 'new', rootRunId: 'task', runs: 1, now: 2000 })).toThrow(
      'the probe budget of the task is exhausted: limit 12, used 40, requested 1',
    );
    database.close();
  });
});
