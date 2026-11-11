import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { openStorage, removeTag, temporaryStorage, renameBack } from '../../feature/storage.ts';
import { run } from '../../feature/runs/helpers.ts';
import { addItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';

describe('tags', () => {
  const tag = (id: string, name: string) => ({
    id,
    repository: '/repo',
    name,
    color: 'blue' as const,
    createdAt: 5,
    task: null,
  });

  it('keeps the catalog and renames a tag under the same id', () => {
    const store = temporaryStorage();
    expect(store.tags.tags()).toEqual([]);
    store.tags.saveTag(tag('tg-a', 'auth'));
    store.tags.saveTag({ ...tag('tg-a', 'login'), color: 'teal' });
    expect(store.tags.tags()).toEqual([
      { id: 'tg-a', repository: '/repo', name: 'login', color: 'teal', createdAt: 5, task: null },
    ]);
  });

  it('removes a tag only in its own repository', () => {
    const store = temporaryStorage();
    store.tags.saveTag(tag('tg-a', 'auth'));
    store.tags.saveTag({ ...tag('tg-a-2', 'auth'), repository: '/other' });
    const mine = run(1, { id: 'mine00000001' });
    mine.run.tags = ['tg-a'];
    store.runs.saveRun(mine);
    const queue = emptyQueue('/other', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-a-2'] }, 'q1', 1);
    store.queues.saveQueue(queue);
    removeTag(store, '/repo', 'tg-a');
    expect(store.tags.tags().map((entry) => entry.id)).toEqual(['tg-a-2']);
    expect(store.runs.loadRun('mine00000001')!.run.tags).toEqual([]);
    // the same id on an item of another repository is not touched
    expect(store.queues.loadQueue('/other')!.items[0]!.tags).toEqual(['tg-a', 'tg-a-2']);
    removeTag(store, '/repo', 'tg-a-2');
    expect(store.tags.tags().map((entry) => entry.id)).toEqual(['tg-a-2']);
  });

  it('keeps the source task of a linked tag across a rename and a reopen', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const linked = {
      ...tag('tg-l', 'cards'),
      color: 'indigo' as const,
      task: { run: 'r1', number: 9 },
    };
    store.tags.saveTag(linked);
    store.tags.saveTag({ ...linked, name: 'cards2', task: null });
    store.database.close();
    const again = openStorage(databasePath(directory));
    expect(again.tags.tags()).toEqual([{ ...linked, name: 'cards2' }]);
    again.database.close();
  });

  it('saves and reads the tags of a run and of a queue item', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.tags = ['tg-a', 'tg-b'];
    store.runs.saveRun(state);
    state.run.tags = ['tg-b'];
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.run.tags).toEqual(['tg-b']);
    expect(store.finished.recentRuns()[0]!.run.tags).toEqual(['tg-b']);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-a', 'tg-b']);
  });

  it('reads runs and items of an older database without tags', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1);
    old.runs.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x' }, 'q1', 1);
    old.queues.saveQueue(queue);
    old.database.exec('DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN after_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN queue_item');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN skip_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN tags_json');
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 4 - (9 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.tags.tags()).toEqual([]);
    expect(store.runs.loadRun(state.run.id)!.run.tags).toEqual([]);
    expect(store.queues.loadQueue('/repo')!.items[0]!.tags).toEqual([]);
  });

  it('removes a tag from the catalog, runs (finished too) and queue items, and keeps the rest', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    store.tags.saveTag(tag('tg-a', 'auth'));
    store.tags.saveTag(tag('tg-b', 'v2'));
    const done = run(1, { id: 'done00000001' });
    transition(done, { kind: 'cancel', group: null }, 10);
    done.run.tags = ['tg-a', 'tg-b'];
    store.runs.saveRun(done);
    const other = run(1, { id: 'other0000001' });
    other.run.tags = ['tg-b'];
    store.runs.saveRun(other);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.queues.saveQueue(queue);
    removeTag(store, '/repo', 'tg-a');
    expect(store.tags.tags().map((entry) => entry.id)).toEqual(['tg-b']);
    expect(store.runs.loadRun('done00000001')!.run.tags).toEqual(['tg-b']);
    expect(store.runs.loadRun('other0000001')!.run.tags).toEqual(['tg-b']);
    expect(store.queues.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-b']);
    store.database.close();
    const reopened = openStorage(databasePath(directory));
    expect(reopened.runs.loadRun('done00000001')!.run.tags).toEqual(['tg-b']);
    expect(reopened.tags.tags().map((entry) => entry.id)).toEqual(['tg-b']);
  });

  it('rolls the removal back when the queue items cannot be updated', () => {
    const store = temporaryStorage();
    store.tags.saveTag(tag('tg-a', 'auth'));
    const state = run(1, { id: 'done00000001' });
    state.run.tags = ['tg-a'];
    store.runs.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a'] }, 'q1', 1);
    store.queues.saveQueue(queue);
    store.database.exec(
      `CREATE TRIGGER fail_items BEFORE UPDATE ON queue_items BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    expect(() => removeTag(store, '/repo', 'tg-a')).toThrow('boom');
    expect(store.tags.tags().map((entry) => entry.id)).toEqual(['tg-a']);
    expect(store.runs.loadRun('done00000001')!.run.tags).toEqual(['tg-a']);
    expect(store.queues.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-a']);
    store.database.close();
  });

  it('does not nest: a repository write with its own transaction fails inside a scenario', () => {
    const store = temporaryStorage();
    store.tags.saveTag(tag('tg-a', 'auth'));
    expect(() =>
      store.database.transaction(() => {
        store.tags.deleteTag('/repo', 'tg-a');
        store.runs.saveRun(run(1, { id: 'run000000001' }));
      }),
    ).toThrow(/within a transaction/);
    expect(store.tags.tags().map((entry) => entry.id)).toEqual(['tg-a']);
    store.database.close();
  });
});
