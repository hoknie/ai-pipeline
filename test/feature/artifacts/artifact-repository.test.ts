import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import type { ArtifactRecord } from '../../../src/feature/artifacts/repositories/index.ts';
import { openStorage, temporaryStorage, type Storage, renameBack } from '../../feature/storage.ts';
import { run, step } from '../../feature/runs/helpers.ts';

describe('artifacts', () => {
  const record = (over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
    id: 'a1',
    runId: 'r1',
    group: 'g1',
    step: 'code',
    seq: 1,
    specialist: 'coder',
    title: 'Report',
    fileName: 'report.md',
    size: 10,
    uri: 'file:///x/r1/a1',
    createdAt: 100,
    ...over,
  });

  function storeWithRun(): Storage {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    return store;
  }

  it('keeps the id when the same attempt publishes the same file again', () => {
    const store = storeWithRun();
    const id = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    const first = store.artifacts.addArtifact(record({ runId: id.id }));
    expect(first.previousUri).toBeNull();
    const second = store.artifacts.addArtifact(
      record({ runId: id.id, id: 'other', size: 20, uri: 'file:///x/r1/other', createdAt: 200 }),
    );
    expect(second.previousUri).toBe('file:///x/r1/a1');
    expect(second.artifact).toMatchObject({ id: 'a1', size: 20, createdAt: 200 });
    expect(store.artifacts.artifacts(id.id, 'g1')).toHaveLength(1);
    expect(store.artifacts.findArtifact(id.id, 'g1', 1, 'report.md')?.id).toBe('a1');
    store.database.close();
  });

  it('gives a new record to another attempt and lists newest first', () => {
    const store = storeWithRun();
    const { id: runId } = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    store.artifacts.addArtifact(record({ runId, id: 'a1', createdAt: 100 }));
    store.artifacts.addArtifact(record({ runId, id: 'a2', seq: 2, createdAt: 100 }));
    store.artifacts.addArtifact(record({ runId, id: 'a3', fileName: 'x.log', createdAt: 300 }));
    store.artifacts.addArtifact(record({ runId, id: 'a4', group: 'g2', createdAt: 50 }));
    expect(store.artifacts.artifacts(runId, 'g1').map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
    expect(store.artifacts.artifact(runId, 'a4')?.group).toBe('g2');
    expect(store.artifacts.artifact(runId, 'nope')).toBeNull();
    expect(store.artifacts.artifactCount(runId, 'g1')).toBe(3);
    expect(store.artifacts.artifactCount(runId, 'none')).toBe(0);
    expect(store.artifacts.artifactCounts(runId)).toEqual(
      new Map([
        ['g1', { count: 3, revision: 300 + 3 * 10 }],
        ['g2', { count: 1, revision: 50 + 10 }],
      ]),
    );
    expect(store.artifacts.artifactUris().get(runId)).toHaveLength(4);
    store.database.close();
  });

  it('migrates an older database and does not mix runs', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    old.database.exec('DROP TABLE artifacts');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (2 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.artifacts.artifactUris().size).toBe(0);
    expect(store.artifacts.artifactCounts('r1').size).toBe(0);
    store.database.close();
  });

  it('removes the artifacts together with their run', () => {
    const store = storeWithRun();
    const { id: runId } = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    store.artifacts.addArtifact(record({ runId }));
    store.database.exec('PRAGMA foreign_keys = ON');
    store.database.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    expect(store.artifacts.artifactCount(runId, 'g1')).toBe(0);
    store.database.close();
  });
});
