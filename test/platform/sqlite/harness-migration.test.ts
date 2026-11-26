import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { Database, MIGRATIONS, SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { RunRepository } from '../../../src/feature/runs/repositories/index.ts';
import { config } from '../../feature/runs/helpers.ts';

function columns(database: DatabaseSync): string[] {
  return database
    .prepare('PRAGMA table_info(runs)')
    .all()
    .map((column) => String(column.name));
}

describe('migration that adds the harness of a run', () => {
  it('reads a run of an older database as a full main run and keeps the harness of a probe', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'aip-harness-')), 'aip.db');
    const old = new DatabaseSync(path);
    MIGRATIONS.slice(0, -2).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 2}`);
    expect(columns(old)).not.toContain('harness');
    expect(columns(old)).not.toContain('probe_of');
    old
      .prepare(
        `INSERT INTO runs (id, repository, pipeline, base_commit, branch, ref_style, created_at, finished_at, config_json, dirty_warning, next_merge_seq)
         VALUES ('old1', '/repo', 'feature', 'abc', 'refs/aip/old1/run', 'refs', 1, 2, ?, 0, 0)`,
      )
      .run(JSON.stringify(config()));
    old.close();

    const database = new Database(path);
    const runs = new RunRepository(database);
    const state = runs.loadRun('old1')!;
    expect(state.run.harness).toBe('full');
    expect(state.run.probeOf).toBeNull();
    state.run.id = 'probe1';
    state.run.branch = 'refs/aip/probe1/run';
    state.run.harness = 'none';
    state.run.probeOf = 'old1';
    runs.saveRun(state);
    const again = runs.loadRun('probe1')!;
    expect(again.run.harness).toBe('none');
    expect(again.run.probeOf).toBe('old1');
    database.close();
  });
});
