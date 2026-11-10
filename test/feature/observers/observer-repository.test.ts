import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { openStorage, renameBack } from '../../feature/storage.ts';
import { run } from '../../feature/runs/helpers.ts';
import { defaultObserverSettings } from '../../../src/feature/observers/types/index.ts';
import { emptyRepair } from '../../../src/feature/runs/types/index.ts';

describe('observers storage', () => {
  it('reads an old database: default settings and default repair', async () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    old.runs.saveRun(run(1));
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - 1}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.observers.loadObservers()).toEqual(defaultObserverSettings());
    expect(store.runs.activeRuns()[0]?.run.repair).toEqual(emptyRepair());
    store.database.close();
  });

  it('keeps settings and the repair of a run after a restart', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const settings = {
      ...defaultObserverSettings(),
      enabled: true,
      workers: 3,
      projects: [{ repository: '/repo', maxWorkers: 2 }],
      specialist: { name: 'W', timeout: '5m' },
    };
    store.observers.saveObservers(settings);
    store.observers.saveObservers({ ...settings, workers: 4 });
    const state = run(1);
    state.run.repair = { ...emptyRepair(), allowed: false, repairs: 1, taken: ['k'] };
    store.runs.saveRun(state);
    state.run.repair = { ...state.run.repair, repairs: 2, cancelReason: 'stop' };
    store.runs.saveRun(state);
    store.database.close();
    const again = openStorage(databasePath(directory));
    expect(again.observers.loadObservers()).toEqual({ ...settings, workers: 4 });
    expect(again.runs.activeRuns()[0]?.run.repair).toMatchObject({
      allowed: false,
      repairs: 2,
      taken: ['k'],
      cancelReason: 'stop',
    });
    again.database.close();
  });
});
