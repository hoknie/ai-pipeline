import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { openStorage, temporaryStorage, renameBack } from '../../feature/storage.ts';
import { run } from '../../feature/runs/helpers.ts';
import { emptyQueue } from '../../../src/feature/queue/types/index.ts';

describe('repository registry', () => {
  it('fills the registry from runs and queues when migrating an older database', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const first = run(1, { now: 50 });
    first.run.repository = '/work/app';
    old.runs.saveRun(first);
    const second = run(1, { id: 'second000001', now: 20 });
    second.run.repository = '/work/app';
    old.runs.saveRun(second);
    old.queues.saveQueue(emptyQueue('/work/lib', 7));
    old.database.exec('DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN after_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN queue_item');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN skip_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN tags_json');
    old.database.exec('DROP TABLE repositories');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN auto_deliver');
    old.database.exec('ALTER TABLE queues DROP COLUMN autopilot');
    old.database.exec('ALTER TABLE queues DROP COLUMN skip_failed');
    old.database.exec('ALTER TABLE queues DROP COLUMN skipped_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN autopilot_answer');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN delivery_mode');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN postponed');
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec('ALTER TABLE runs DROP COLUMN skipped_steps_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN number');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN number');
    old.database.exec('ALTER TABLE queues DROP COLUMN next_number');
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5 - (11 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.known.repositories()).toEqual([
      { path: '/work/app', addedAt: 20, name: null, slug: null, enabled: true, color: null },
      { path: '/work/lib', addedAt: 7, name: null, slug: null, enabled: true, color: null },
    ]);
  });

  it('adds a repository once and keeps its first addedAt', () => {
    const store = temporaryStorage();
    expect(store.known.addRepository('/repo', 5)).toBe(true);
    expect(store.known.addRepository('/repo', 9)).toBe(false);
    expect(store.known.repositories()).toEqual([
      { path: '/repo', addedAt: 5, name: null, slug: null, enabled: true, color: null },
    ]);
  });

  it('removes only the registry entry and survives reopening', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    store.runs.saveRun(state);
    store.known.addRepository(state.run.repository, 1);
    store.known.addRepository('/other', 2);
    store.known.removeRepository('/other');
    store.database.close();
    const reopened = openStorage(databasePath(directory));
    expect(reopened.known.repositories().map((entry) => entry.path)).toEqual([
      state.run.repository,
    ]);
    expect(reopened.runs.loadRun(state.run.id)).not.toBeNull();
  });

  it('writes the attributes of a project and moves it to another path', () => {
    const store = temporaryStorage();
    store.known.addRepository('/work/app', 5, { slug: 'app' });
    store.known.updateRepository({
      path: '/work/app',
      addedAt: 99,
      name: 'Shop',
      slug: 'shop',
      enabled: false,
      color: 'teal',
    });
    store.known.moveRepository('/work/app', '/projects/app');
    expect(store.known.repositories()).toEqual([
      {
        path: '/projects/app',
        addedAt: 5,
        name: 'Shop',
        slug: 'shop',
        enabled: false,
        color: 'teal',
      },
    ]);
    store.known.addRepository('/work/lib', 6);
    expect(() =>
      store.known.updateRepository({
        path: '/work/lib',
        addedAt: 6,
        name: null,
        slug: 'shop',
        enabled: true,
        color: null,
      }),
    ).toThrow(/UNIQUE/);
  });
});
