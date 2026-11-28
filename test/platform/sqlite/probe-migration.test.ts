import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { ProbeAdmissionRepository } from '../../../src/feature/runs/repositories/index.ts';
import { PROBE_LIMITS } from '../../../src/feature/runs/types/index.ts';
import { Database, MIGRATIONS, SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import {
  StatsRecordRepository,
  StatsReportRepository,
} from '../../../src/feature/stats/repositories/index.ts';
import { config } from '../../feature/runs/helpers.ts';

function insertRun(database: DatabaseSync, id: string, probeOf: string | null): void {
  database
    .prepare(
      `INSERT INTO runs (id, repository, pipeline, base_commit, branch, ref_style, created_at, finished_at, config_json, dirty_warning, next_merge_seq, probe_of)
       VALUES (?, '/repo', 'feature', 'abc', ?, 'refs', 1, 2, ?, 0, 0, ?)`,
    )
    .run(id, `refs/aip/${id}/run`, JSON.stringify(config()), probeOf);
}

function insertRecords(database: DatabaseSync, runId: string): void {
  database
    .prepare(
      `INSERT INTO stats_attempts (run_id, group_slug, seq, kind, repository, pipeline, step_id,
         specialist, runtime, status, started_at, finished_at, duration_ms, input_tokens, output_tokens)
       VALUES (?, 'g', 1, 'step', '/repo', 'feature', 'code', 'coder', 'claude', 'finished', 1, 2, 1, 10, 4)`,
    )
    .run(runId);
  database
    .prepare(
      `INSERT INTO stats_runs (run_id, repository, pipeline, created_at, finished_at, wall_ms, outcome)
       VALUES (?, '/repo', 'feature', 1, 2, 1, 'finished')`,
    )
    .run(runId);
}

describe('migration of the journal to the origin of a record', () => {
  it('reads every old record as an ordinary one and starts with an empty table of admissions', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'aip-probe-migration-')), 'aip.db');
    const old = new DatabaseSync(path);
    MIGRATIONS.slice(0, -2).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 2}`);
    const columns = (
      old.prepare('PRAGMA table_info(stats_attempts)').all() as { name: string }[]
    ).map((column) => column.name);
    expect(columns).not.toContain('is_probe');
    // A probe of the older builds and a run that only bears the name: both stay in the journal.
    insertRun(old, 'probe1', 'main');
    insertRun(old, 'probe-named', null);
    insertRecords(old, 'probe1');
    insertRecords(old, 'probe-named');
    old.close();

    const database = new Database(path);
    expect(
      database.prepare('SELECT run_id, is_probe FROM stats_attempts ORDER BY run_id').all(),
    ).toEqual([
      { run_id: 'probe-named', is_probe: 0 },
      { run_id: 'probe1', is_probe: 0 },
    ]);
    expect(
      database.prepare('SELECT run_id, is_probe FROM stats_runs ORDER BY run_id').all(),
    ).toEqual([
      { run_id: 'probe-named', is_probe: 0 },
      { run_id: 'probe1', is_probe: 0 },
    ]);
    // The reservations of an older daemon are restored by the probes service, not in SQL.
    expect(database.prepare('SELECT COUNT(*) AS n FROM probe_admissions').get()).toEqual({ n: 0 });
    database.close();
  });
});
