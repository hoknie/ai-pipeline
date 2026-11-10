import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import {
  maxTaskNumber,
  openStorage,
  temporaryStorage,
  type Storage,
  renameBack,
} from '../../feature/storage.ts';
import { finish, run, step } from '../../feature/runs/helpers.ts';
import { addItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';

describe('queues', () => {
  it('has no queue for an unknown repository', () => {
    const store = temporaryStorage();
    expect(store.queues.loadQueue('/repo')).toBeNull();
    expect(store.queues.queues()).toEqual([]);
  });

  it('keeps items, order, stop and known problems', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'первая' }, 'q1', 2);
    addItem(
      queue,
      { pipeline: 'feature', groups: [{ title: 'Вход', task: 'форма' }], title: 'Группы' },
      'q2',
      3,
    );
    queue.status = 'running';
    queue.parallel = 3;
    queue.runs = ['r1'];
    queue.acknowledged = ['r1/a/failed/1'];
    queue.stop = { kind: 'problem', run: 'r1', group: 'a', reason: 'failed' };
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')).toEqual(queue);
    queue.items.reverse();
    queue.items[0]!.error = 'boom';
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')?.items.map((item) => item.id)).toEqual(['q2', 'q1']);
    expect(store.queues.loadQueue('/repo')?.items[0]?.error).toBe('boom');
    expect(store.queues.queues()).toHaveLength(1);
  });

  it('keeps the skipped steps of an item and reads old rows as empty', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', skip: ['review', 'qa'] }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')?.items.map((item) => item.skip)).toEqual([
      ['review', 'qa'],
      [],
    ]);
    store.database.prepare("UPDATE queue_items SET skip_json = '[]' WHERE id = 'q1'").run();
    expect(store.queues.loadQueue('/repo')?.items[0]?.skip).toEqual([]);
  });

  it('keeps the skipped steps of a run and reads an old row as empty', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.skippedSteps = ['qa'];
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.skippedSteps).toEqual(['qa']);
    store.database.prepare("UPDATE runs SET skipped_steps_json = ''").run();
    expect(store.runs.loadRun(state.run.id)?.run.skippedSteps).toEqual([]);
  });

  it('keeps the dependencies of an item and the queue item of a run', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', after: ['r1', 'q0'] }, 'q1', 1);
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')?.items[0]?.after).toEqual(['r1', 'q0']);
    const state = run(1);
    state.run.queueItem = 'q7';
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.queueItem).toBe('q7');
    expect(store.runs.runOfQueueItem('/repo', 'q7')?.run.id).toBe(state.run.id);
    expect(store.runs.runOfQueueItem('/repo', 'q8')).toBeNull();
    expect(run(1, { id: 'run000000002' }).run.queueItem).toBeNull();
  });

  it('reads items and runs of an older database without dependencies', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = openStorage(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a' }, 'q0', 1);
    old.queues.saveQueue(queue);
    old.runs.saveRun(run(1));
    old.database.exec('ALTER TABLE queue_items DROP COLUMN after_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN queue_item');
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
    old.database.exec('ALTER TABLE tags DROP COLUMN task_run');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_number');
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (7 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.queues.loadQueue('/repo')?.items[0]?.after).toEqual([]);
    expect(store.queues.loadQueue('/repo')?.items[0]?.run).toBeNull();
    expect(store.runs.loadRun('run000000001')?.run.queueItem).toBeNull();
    store.database.close();
  });

  it('keeps the settings and the skipped runs of a queue', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    queue.autopilot = true;
    queue.autoAnswer = true;
    queue.skipFailed = true;
    queue.skipped = ['r2', 'r1'];
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')).toMatchObject({
      autopilot: true,
      autoAnswer: true,
      skipFailed: true,
      skipped: ['r2', 'r1'],
    });
    expect(store.queues.queues()[0]).toEqual(queue);
  });

  it('copies autopilot to auto answer when migrating an older database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = openStorage(databasePath(directory));
    const on = emptyQueue('/on', 1);
    on.autopilot = true;
    const off = emptyQueue('/off', 1);
    old.queues.saveQueue(on);
    old.queues.saveQueue(off);
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (5 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.queues.loadQueue('/on')).toMatchObject({ autopilot: true, autoAnswer: true });
    expect(store.queues.loadQueue('/off')).toMatchObject({ autopilot: false, autoAnswer: false });
    store.database.close();
  });

  it('reads a queue saved before the settings with both modes off', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = openStorage(databasePath(directory));
    old.queues.saveQueue(emptyQueue('/repo', 1));
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
    old.database.exec('ALTER TABLE tags DROP COLUMN task_run');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_number');
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (6 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.queues.loadQueue('/repo')).toMatchObject({
      autopilot: false,
      skipFailed: false,
      skipped: [],
      onLimit: 'wait',
    });
    store.database.close();
  });

  it('keeps onLimit, a stop by a usage limit and a returned run', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'первая' }, 'q1', 2);
    queue.items[0]!.run = 'r1';
    queue.onLimit = 'stop';
    queue.stop = {
      kind: 'limit',
      run: 'r1',
      group: 'a',
      runtime: 'claude',
      resetsAt: 50_000,
      autoResume: true,
    };
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')).toEqual(queue);
  });

  it('keeps the postponed flag and reads an older database as not postponed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = openStorage(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', postponed: true }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
    old.queues.saveQueue(queue);
    expect(old.queues.loadQueue('/repo')?.items.map((item) => item.postponed)).toEqual([
      true,
      false,
    ]);
    old.database.exec('ALTER TABLE queue_items DROP COLUMN postponed');
    old.database.exec('ALTER TABLE runs DROP COLUMN skipped_steps_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN number');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN number');
    old.database.exec('ALTER TABLE queues DROP COLUMN next_number');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_run');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_number');
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (3 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.queues.loadQueue('/repo')?.items.map((item) => item.postponed)).toEqual([
      false,
      false,
    ]);
    store.database.close();
  });

  function beforeNumbers(directory: string, fill: (store: Storage) => void): void {
    const old = openStorage(databasePath(directory));
    fill(old);
    old.database.exec('ALTER TABLE runs DROP COLUMN number');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN number');
    old.database.exec('ALTER TABLE queues DROP COLUMN next_number');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_run');
    old.database.exec('ALTER TABLE tags DROP COLUMN task_number');
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (1 + 8 + 1)}`);
    old.database.close();
  }

  it('numbers the tasks of an older database: runs by creation, then items, and sets the counter', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    beforeNumbers(directory, (old) => {
      old.runs.saveRun(run(1, { id: 'run000000001', now: 20 }));
      old.runs.saveRun(run(1, { id: 'run000000002', now: 10 }));
      const queue = emptyQueue('/repo', 1);
      addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
      addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
      old.queues.saveQueue(queue);
    });
    const store = openStorage(databasePath(directory));
    expect(store.runs.loadRun('run000000002')?.run.number).toBe(1);
    expect(store.runs.loadRun('run000000001')?.run.number).toBe(2);
    const queue = store.queues.loadQueue('/repo');
    expect(queue?.items.map((item) => item.number)).toEqual([3, 4]);
    expect(queue?.nextNumber).toBe(5);
    expect(maxTaskNumber(store, '/repo')).toBe(4);
    expect(maxTaskNumber(store, '/other')).toBe(0);
    store.database.close();
    const reopened = openStorage(databasePath(directory));
    expect(reopened.runs.loadRun('run000000001')?.run.number).toBe(2);
    expect(reopened.queues.loadQueue('/repo')?.items.map((item) => item.number)).toEqual([3, 4]);
    expect(reopened.queues.loadQueue('/repo')?.nextNumber).toBe(5);
    reopened.database.close();
  });

  it('gives a returned item of an older database the number of its run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    beforeNumbers(directory, (old) => {
      old.runs.saveRun(run(1, { id: 'run000000001', now: 10 }));
      old.runs.saveRun(run(1, { id: 'run000000002', now: 20 }));
      const queue = emptyQueue('/repo', 1);
      addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
      addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
      queue.items[1]!.task = null;
      queue.items[1]!.run = 'run000000001';
      old.queues.saveQueue(queue);
    });
    const store = openStorage(databasePath(directory));
    const queue = store.queues.loadQueue('/repo');
    expect(queue?.items.map((item) => item.number)).toEqual([3, 1]);
    expect(queue?.nextNumber).toBe(4);
    store.database.close();
  });

  it('keeps the numbers and the counter of a queue', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.number = 7;
    store.runs.saveRun(state);
    const queue = emptyQueue('/repo', 1, 8);
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
    store.queues.saveQueue(queue);
    expect(store.runs.loadRun(state.run.id)?.run.number).toBe(7);
    expect(store.queues.loadQueue('/repo')?.items[0]?.number).toBe(8);
    expect(store.queues.loadQueue('/repo')?.nextNumber).toBe(9);
    expect(maxTaskNumber(store, '/repo')).toBe(8);
    store.database.close();
  });

  it('finds a run of the repository by its task number', () => {
    const store = temporaryStorage();
    const state = run(1, { id: 'run000000001', now: 10 });
    state.run.repository = '/repo';
    state.run.number = 7;
    store.runs.saveRun(state);
    expect(store.runs.runIdByNumber('/repo', 7)).toBe('run000000001');
    expect(store.runs.runIdByNumber('/other', 7)).toBeNull();
    expect(store.runs.runIdByNumber('/repo', 8)).toBeNull();
    store.database.close();
  });

  it('keeps the queue origin of a run', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.fromQueue = true;
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.fromQueue).toBe(true);
  });
});

describe('queue items and automatic delivery', () => {
  it('keeps true, false and null of an item', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    for (const [index, autoDeliver] of [true, false, null].entries()) {
      addItem(
        queue,
        { pipeline: 'feature', task: `t${index}`, autoDeliver: autoDeliver ?? undefined },
        `q${index}`,
        1,
      );
    }
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')?.items.map((item) => item.autoDeliver)).toEqual([
      true,
      false,
      null,
    ]);
  });

  it('keeps the delivery mode of an item and the autopilot answer of a queue', () => {
    const store = temporaryStorage();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', deliveryMode: 'commit' }, 'q0', 1);
    addItem(queue, { pipeline: 'feature', task: 'b' }, 'q1', 1);
    queue.autopilotAnswer = 'Согласен';
    store.queues.saveQueue(queue);
    const loaded = store.queues.loadQueue('/repo');
    expect(loaded?.items.map((item) => item.deliveryMode)).toEqual(['commit', null]);
    expect(loaded?.autopilotAnswer).toBe('Согласен');
    store.database.exec("UPDATE queue_items SET delivery_mode = 'tar' WHERE id = 'q0'");
    expect(store.queues.loadQueue('/repo')?.items[0]?.deliveryMode).toBeNull();
  });

  it('keeps who answered a question and reads old decisions as human', () => {
    const store = temporaryStorage();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'ok', by: 'autopilot' }, 5);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.groups[0]?.decisions[0]?.by).toBe('autopilot');
    store.database.exec(
      `UPDATE groups SET decisions_json = '[{"stepId":"s","question":"q","answer":"a"}]'`,
    );
    expect(store.runs.loadRun(state.run.id)?.groups[0]?.decisions[0]?.by).toBe('human');
  });

  it('keeps the attempt number of a decision and reads old decisions without it', () => {
    const store = temporaryStorage();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'ok' }, 5);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.groups[0]?.decisions[0]?.attemptSeq).toBe(1);
    store.database.exec(
      `UPDATE groups SET decisions_json = '[{"stepId":"s","question":"q","answer":"a","attemptSeq":"x"}]'`,
    );
    const old = store.runs.loadRun(state.run.id)?.groups[0]?.decisions[0];
    expect(old).toBeDefined();
    expect(old).not.toHaveProperty('attemptSeq');
  });

  it('reads items of an older database as following the setting', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', autoDeliver: false }, 'q0', 1);
    old.queues.saveQueue(queue);
    old.database.exec('DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN after_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN queue_item');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN skip_json');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN tags_json');
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3 - (10 + 8 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.queues.loadQueue('/repo')?.items[0]?.autoDeliver).toBeNull();
  });
});
