import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { openStorage, temporaryStorage, renameBack } from '../../feature/storage.ts';
import { run } from '../../feature/runs/helpers.ts';

describe('patch of a run', () => {
  it('stores, replaces and reads the reference, and drops it with the run', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    expect(store.patches.runPatch(state.run.id)).toBeNull();
    const record = { uri: 'file:///p/a.patch', commit: 'abc', size: 10, createdAt: 5 };
    store.patches.setRunPatch(state.run.id, record);
    expect(store.patches.runPatch(state.run.id)).toEqual(record);
    const next = { ...record, uri: 's3://bucket/b.patch', commit: 'def' };
    store.patches.setRunPatch(state.run.id, next);
    expect(store.patches.runPatch(state.run.id)).toEqual(next);
    expect(store.patches.runPatchIds()).toEqual([state.run.id]);
    store.database.prepare('DELETE FROM runs WHERE id = ?').run(state.run.id);
    expect(store.patches.runPatch(state.run.id)).toBeNull();
    expect(store.patches.runPatchIds()).toEqual([]);
  });

  it('migrates a database from before the table', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    old.runs.saveRun(run(1));
    old.database.exec('DROP TABLE run_patches');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 7 - (4 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.patches.runPatchIds()).toEqual([]);
    store.database.close();
  });
});
