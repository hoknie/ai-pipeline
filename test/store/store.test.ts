import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  databasePath,
  ensureDirectory,
  socketPath,
  stateDirectory,
} from '../../src/platform/paths/index.ts';
import { SCHEMA_VERSION, Store, migrate, type ArtifactRecord } from '../../src/store/index.ts';
import { finish, run, step } from '../core/helpers.ts';
import {
  addItem,
  defaultObserverSettings,
  dispatch,
  emptyQueue,
  emptyRepair,
  transition,
} from '../../src/core/index.ts';

function temporaryStore(): Store {
  const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
  const store = new Store(databasePath(directory));
  store.database.exec('PRAGMA synchronous = OFF');
  return store;
}

/** Gives a database built from the current schema the column names of the builds before the rename. */
function renameBack(database: import('node:sqlite').DatabaseSync): void {
  for (const table of ['runs', 'queue_items']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((column) => column.name === 'pipeline')) {
      database.exec(`ALTER TABLE ${table} RENAME COLUMN pipeline TO workflow`);
    }
  }
}

describe('state directory', () => {
  it('lives under XDG_STATE_HOME or ~/.local/state', () => {
    expect(stateDirectory('/xdg', '/home/u')).toBe('/xdg/aip');
    expect(stateDirectory(undefined, '/home/u')).toBe('/home/u/.local/state/aip');
    expect(stateDirectory('relative', '/home/u')).toBe('/home/u/.local/state/aip');
  });

  it('is created with mode 0700 and holds the database', () => {
    const directory = ensureDirectory(
      join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'state', 'aip'),
    );
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    new Store(databasePath(directory)).close();
    expect(statSync(databasePath(directory)).isFile()).toBe(true);
  });
});

describe('socket path', () => {
  it('stays in the state directory when short and moves to a short temporary path otherwise', () => {
    expect(socketPath('/home/u/.local/state/aip')).toBe('/home/u/.local/state/aip/aip.sock');
    const long = `/${'x'.repeat(120)}/aip`;
    const path = socketPath(long, '/tmp');
    expect(path).toMatch(/^\/tmp\/aip-[0-9a-f]{16}\.sock$/);
    expect(socketPath(long, '/tmp')).toBe(path);
  });
});

describe('migrations', () => {
  it('sets the schema version and changes nothing when run again', () => {
    const store = temporaryStore();
    const version = () =>
      (store.database.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version;
    expect(version()).toBe(SCHEMA_VERSION);
    const tables = () =>
      store.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
    const before = tables();
    migrate(store.database);
    expect(version()).toBe(SCHEMA_VERSION);
    expect(tables()).toEqual(before);
    const mode = store.database.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
  });
});

describe('hold of a run and priority runs', () => {
  it('keeps the hold of a run and the priority list of a queue', () => {
    const store = temporaryStore();
    const state = run(1);
    state.run.hold = 'frozen';
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run.hold).toBe('frozen');
    state.run.hold = null;
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run.hold).toBeNull();
    const queue = emptyQueue('/repo', 1);
    queue.priority = ['r1', 'r2'];
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.priority).toEqual(['r1', 'r2']);
  });

  it('reads an older database with no hold and an empty priority list', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const state = run(1);
    old.saveRun(state);
    old.saveQueue(emptyQueue('/repo', 1));
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('DROP TABLE run_patches');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (7 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadRun(state.run.id)?.run.hold).toBeNull();
    expect(store.loadQueue('/repo')?.priority).toEqual([]);
  });
});

describe('queues', () => {
  it('has no queue for an unknown repository', () => {
    const store = temporaryStore();
    expect(store.loadQueue('/repo')).toBeNull();
    expect(store.queues()).toEqual([]);
  });

  it('keeps items, order, stop and known problems', () => {
    const store = temporaryStore();
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
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')).toEqual(queue);
    queue.items.reverse();
    queue.items[0]!.error = 'boom';
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.items.map((item) => item.id)).toEqual(['q2', 'q1']);
    expect(store.loadQueue('/repo')?.items[0]?.error).toBe('boom');
    expect(store.queues()).toHaveLength(1);
  });

  it('keeps the skipped steps of an item and reads old rows as empty', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', skip: ['review', 'qa'] }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.items.map((item) => item.skip)).toEqual([
      ['review', 'qa'],
      [],
    ]);
    store.database.prepare("UPDATE queue_items SET skip_json = '[]' WHERE id = 'q1'").run();
    expect(store.loadQueue('/repo')?.items[0]?.skip).toEqual([]);
  });

  it('keeps the skipped steps of a run and reads an old row as empty', () => {
    const store = temporaryStore();
    const state = run(1);
    state.run.skippedSteps = ['qa'];
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run.skippedSteps).toEqual(['qa']);
    store.database.prepare("UPDATE runs SET skipped_steps_json = ''").run();
    expect(store.loadRun(state.run.id)?.run.skippedSteps).toEqual([]);
  });

  it('keeps the dependencies of an item and the queue item of a run', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', after: ['r1', 'q0'] }, 'q1', 1);
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.items[0]?.after).toEqual(['r1', 'q0']);
    const state = run(1);
    state.run.queueItem = 'q7';
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run.queueItem).toBe('q7');
    expect(store.runOfQueueItem('/repo', 'q7')?.run.id).toBe(state.run.id);
    expect(store.runOfQueueItem('/repo', 'q8')).toBeNull();
    expect(run(1, { id: 'run000000002' }).run.queueItem).toBeNull();
  });

  it('reads items and runs of an older database without dependencies', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = new Store(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a' }, 'q0', 1);
    old.saveQueue(queue);
    old.saveRun(run(1));
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (7 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadQueue('/repo')?.items[0]?.after).toEqual([]);
    expect(store.loadQueue('/repo')?.items[0]?.run).toBeNull();
    expect(store.loadRun('run000000001')?.run.queueItem).toBeNull();
    store.close();
  });

  it('keeps the settings and the skipped runs of a queue', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    queue.autopilot = true;
    queue.autoAnswer = true;
    queue.skipFailed = true;
    queue.skipped = ['r2', 'r1'];
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')).toMatchObject({
      autopilot: true,
      autoAnswer: true,
      skipFailed: true,
      skipped: ['r2', 'r1'],
    });
    expect(store.queues()[0]).toEqual(queue);
  });

  it('copies autopilot to auto answer when migrating an older database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = new Store(databasePath(directory));
    const on = emptyQueue('/on', 1);
    on.autopilot = true;
    const off = emptyQueue('/off', 1);
    old.saveQueue(on);
    old.saveQueue(off);
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (5 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadQueue('/on')).toMatchObject({ autopilot: true, autoAnswer: true });
    expect(store.loadQueue('/off')).toMatchObject({ autopilot: false, autoAnswer: false });
    store.close();
  });

  it('reads a queue saved before the settings with both modes off', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = new Store(databasePath(directory));
    old.saveQueue(emptyQueue('/repo', 1));
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (6 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadQueue('/repo')).toMatchObject({
      autopilot: false,
      skipFailed: false,
      skipped: [],
      onLimit: 'wait',
    });
    store.close();
  });

  it('keeps onLimit, a stop by a usage limit and a returned run', () => {
    const store = temporaryStore();
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
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')).toEqual(queue);
  });

  it('keeps the postponed flag and reads an older database as not postponed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const old = new Store(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', postponed: true }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
    old.saveQueue(queue);
    expect(old.loadQueue('/repo')?.items.map((item) => item.postponed)).toEqual([true, false]);
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (3 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadQueue('/repo')?.items.map((item) => item.postponed)).toEqual([false, false]);
    store.close();
  });

  function beforeNumbers(directory: string, fill: (store: Store) => void): void {
    const old = new Store(databasePath(directory));
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (1 + 8 + 1)}`);
    old.close();
  }

  it('numbers the tasks of an older database: runs by creation, then items, and sets the counter', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    beforeNumbers(directory, (old) => {
      old.saveRun(run(1, { id: 'run000000001', now: 20 }));
      old.saveRun(run(1, { id: 'run000000002', now: 10 }));
      const queue = emptyQueue('/repo', 1);
      addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
      addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
      old.saveQueue(queue);
    });
    const store = new Store(databasePath(directory));
    expect(store.loadRun('run000000002')?.run.number).toBe(1);
    expect(store.loadRun('run000000001')?.run.number).toBe(2);
    const queue = store.loadQueue('/repo');
    expect(queue?.items.map((item) => item.number)).toEqual([3, 4]);
    expect(queue?.nextNumber).toBe(5);
    expect(store.maxTaskNumber('/repo')).toBe(4);
    expect(store.maxTaskNumber('/other')).toBe(0);
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun('run000000001')?.run.number).toBe(2);
    expect(reopened.loadQueue('/repo')?.items.map((item) => item.number)).toEqual([3, 4]);
    expect(reopened.loadQueue('/repo')?.nextNumber).toBe(5);
    reopened.close();
  });

  it('gives a returned item of an older database the number of its run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    beforeNumbers(directory, (old) => {
      old.saveRun(run(1, { id: 'run000000001', now: 10 }));
      old.saveRun(run(1, { id: 'run000000002', now: 20 }));
      const queue = emptyQueue('/repo', 1);
      addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
      addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 3);
      queue.items[1]!.task = null;
      queue.items[1]!.run = 'run000000001';
      old.saveQueue(queue);
    });
    const store = new Store(databasePath(directory));
    const queue = store.loadQueue('/repo');
    expect(queue?.items.map((item) => item.number)).toEqual([3, 1]);
    expect(queue?.nextNumber).toBe(4);
    store.close();
  });

  it('keeps the numbers and the counter of a queue', () => {
    const store = temporaryStore();
    const state = run(1);
    state.run.number = 7;
    store.saveRun(state);
    const queue = emptyQueue('/repo', 1, 8);
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 2);
    store.saveQueue(queue);
    expect(store.loadRun(state.run.id)?.run.number).toBe(7);
    expect(store.loadQueue('/repo')?.items[0]?.number).toBe(8);
    expect(store.loadQueue('/repo')?.nextNumber).toBe(9);
    expect(store.maxTaskNumber('/repo')).toBe(8);
    store.close();
  });

  it('finds a run of the repository by its task number', () => {
    const store = temporaryStore();
    const state = run(1, { id: 'run000000001', now: 10 });
    state.run.repository = '/repo';
    state.run.number = 7;
    store.saveRun(state);
    expect(store.runIdByNumber('/repo', 7)).toBe('run000000001');
    expect(store.runIdByNumber('/other', 7)).toBeNull();
    expect(store.runIdByNumber('/repo', 8)).toBeNull();
    store.close();
  });

  it('keeps the queue origin of a run', () => {
    const store = temporaryStore();
    const state = run(1);
    state.run.fromQueue = true;
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run.fromQueue).toBe(true);
  });
});

describe('runs', () => {
  it('reads back exactly what it saved', () => {
    const store = temporaryStore();
    const state = run(2);
    step(state);
    finish(state, 'done', { summary: 'план' });
    step(state);
    finish(state, 'rejected', { slug: 'gruppa-2', feedback: 'нет' });
    state.groups[0]!.attempts.at(-1)!.usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };
    store.saveRun(state);
    expect(store.loadRun(state.run.id)).toEqual(state);
  });

  it('keeps structured questions of a group waiting for a human', () => {
    const store = temporaryStore();
    const state = run(1);
    step(state);
    const questions = [
      { text: 'OAuth или пароль?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
      { text: 'Где хранить?' },
    ];
    finish(state, 'needs_human', { questions });
    store.saveRun(state);
    const loaded = store.loadRun(state.run.id)!;
    expect(loaded.groups[0]!.questions).toEqual(questions);
    expect(loaded).toEqual(state);
  });

  it('keeps the human-only mark of a group and reads an unknown value as none', () => {
    const store = temporaryStore();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'Глянь', humanOnly: true });
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.groups[0]!.humanOnly).toBe('request');
    state.groups[0]!.humanOnly = 'review';
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.groups[0]!.humanOnly).toBe('review');
    store.database.exec("UPDATE groups SET human_only = 'bogus'");
    expect(store.loadRun(state.run.id)!.groups[0]!.humanOnly).toBeNull();
    store.database.exec('UPDATE groups SET human_only = NULL');
    expect(store.loadRun(state.run.id)!.groups[0]!.humanOnly).toBeNull();
  });

  it('keeps the title, the name and the usage of naming', () => {
    const store = temporaryStore();
    const state = run(1);
    store.saveRun(state);
    transition(
      state,
      {
        kind: 'run_named',
        title: 'Флаг --json',
        name: 'add-json-flag',
        usage: { inputTokens: 30, outputTokens: 10, costUsd: 0.002 },
      },
      60,
    );
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.run).toMatchObject({
      title: 'Флаг --json',
      name: 'add-json-flag',
      namingUsage: { inputTokens: 30, outputTokens: 10, costUsd: 0.002 },
    });
  });

  it('updates a run after a transition', () => {
    const store = temporaryStore();
    const state = run(1);
    store.saveRun(state);
    step(state);
    store.saveRun(state);
    transition(state, { kind: 'cancel', group: null }, 50);
    store.saveRun(state);
    const loaded = store.loadRun(state.run.id);
    expect(loaded?.groups[0]?.status).toBe('cancelled');
    expect(loaded?.run.finishedAt).toBe(50);
    expect(store.loadRun('missing')).toBeNull();
  });

  it('fails attempts that were running when the daemon stopped and keeps the queue', () => {
    const store = temporaryStore();
    const state = run(2, { max: 1 });
    step(state);
    store.saveRun(state);
    store.recover(99);
    const loaded = store.loadRun(state.run.id)!;
    expect(loaded.groups[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(loaded.groups[0]?.attempts[0]?.reason).toEqual({ kind: 'interrupted' });
    expect(loaded.groups[1]?.status).toBe('queued');
    expect(store.activeRuns().map((active) => active.run.id)).toEqual([state.run.id]);
  });

  it('starts again the delivery of a finished run cut off by a restart', () => {
    const store = temporaryStore();
    const state = run(1);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    const merged = transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c' } },
      60,
    );
    expect(merged).toEqual([expect.objectContaining({ kind: 'deliver', auto: true })]);
    expect(state.run.finishedAt).toBe(60);
    store.saveRun(state);
    const recovered = store.recover(99);
    expect(recovered.map(({ state: each }) => each.run.id)).toEqual([state.run.id]);
    expect(recovered[0]?.effects).toEqual([
      expect.objectContaining({ kind: 'deliver', groups: ['gruppa-1'], auto: true }),
    ]);
    expect(store.loadRun(state.run.id)?.run.pendingDelivery).toMatchObject({ auto: true });
  });

  it('lists finished runs by finish time, the latest first, without active ones', () => {
    const store = temporaryStore();
    for (const [id, at] of [
      ['finished0001', 300],
      ['finished0002', 500],
      ['finished0003', 400],
    ] as const) {
      const finished = run(1, { id, now: 100 });
      transition(finished, { kind: 'cancel', group: null }, at);
      store.saveRun(finished);
    }
    store.saveRun(run(1, { id: 'activerun001', now: 50 }));
    expect(store.finishedRuns().map((state) => state.run.id)).toEqual([
      'finished0002',
      'finished0003',
      'finished0001',
    ]);
  });

  it('lists active runs and the ten latest finished ones', () => {
    const store = temporaryStore();
    for (let index = 0; index < 12; index += 1) {
      const finished = run(1, {
        id: `finished${String(index).padStart(4, '0')}`,
        now: 100 + index,
      });
      transition(finished, { kind: 'cancel', group: null }, 200);
      store.saveRun(finished);
    }
    store.saveRun(run(1, { id: 'activerun001', now: 50 }));
    const recent = store.recentRuns().map((state) => state.run.id);
    expect(recent).toHaveLength(11);
    expect(recent[0]).toBe('activerun001');
    expect(recent[1]).toBe('finished0011');
    expect(recent.at(-1)).toBe('finished0002');
  });
});

describe('split persistence', () => {
  it('stores the split group, proposals and warnings', () => {
    const store = temporaryStore();
    const state = run(1, {
      split: true,
      configText: `swarm:
  specialists:
    plan: { name: P }
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: plan, specialist: plan }
`,
    });
    step(state);
    transition(state, { kind: 'split_proposed', seq: 1, groups: [{ title: 'A', task: 'a' }] }, 5);
    state.split!.warnings.push('w');
    store.saveRun(state);
    expect(store.loadRun(state.run.id)).toEqual(state);
  });
});

describe('run hold', () => {
  it('keeps the hold of a run', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    expect(state.run.hold).toBeNull();
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.run.hold).toBeNull();
    state.run.hold = 'paused';
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.run.hold).toBe('paused');
    store.close();
  });
});

describe('refused tool calls', () => {
  it('keeps the denials of an attempt and reads older attempts as none', async () => {
    const { MIGRATIONS } = await import('../../src/store/index.ts');
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    step(state);
    const attempt = state.groups[0]!.attempts[0]!;
    attempt.denials = [{ tool: 'Bash', command: 'python3 fix.py' }];
    store.saveRun(state);
    // As a database written before the column existed.
    renameBack(store.database);
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN human_only; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN denials_json; ALTER TABLE attempts DROP COLUMN outside_changes_json; ALTER TABLE runs DROP COLUMN skipped_steps_json; ALTER TABLE runs DROP COLUMN number; ALTER TABLE runs DROP COLUMN hold; ALTER TABLE runs DROP COLUMN repair_json; DROP TABLE observers; PRAGMA user_version = 3',
    );
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([]);
    reopened.saveRun(state);
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([
      { tool: 'Bash', command: 'python3 fix.py' },
    ]);
    reopened.close();
    expect(MIGRATIONS.at(-25)).toContain('denials_json');
  });

  it('keeps the files an attempt changed outside its worktree and reads older attempts as none', async () => {
    const { MIGRATIONS } = await import('../../src/store/index.ts');
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    step(state);
    state.groups[0]!.attempts[0]!.outsideChanges = ['README.md', 'docs/a.md'];
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.groups[0]!.attempts[0]!.outsideChanges).toEqual([
      'README.md',
      'docs/a.md',
    ]);
    // As a database written before the column existed.
    renameBack(store.database);
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN human_only; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN outside_changes_json; ALTER TABLE runs DROP COLUMN skipped_steps_json; ALTER TABLE runs DROP COLUMN number; ALTER TABLE runs DROP COLUMN hold; ALTER TABLE runs DROP COLUMN repair_json; DROP TABLE observers; PRAGMA user_version = 4',
    );
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.outsideChanges).toEqual([]);
    reopened.close();
    expect(MIGRATIONS.at(-24)).toContain('outside_changes_json');
  });
});

describe('migration to hidden refs', () => {
  it('keeps runs created before the change on visible branches', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../src/store/index.ts');
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const legacy = new DatabaseSync(databasePath(directory));
    legacy.exec(MIGRATIONS[0] ?? '');
    legacy.exec('PRAGMA user_version = 1');
    const state = run(1);
    legacy
      .prepare(
        'INSERT INTO runs (id, repository, workflow, base_commit, branch, created_at, finished_at, config_json, dirty_warning, next_merge_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)',
      )
      .run(
        'legacyrun001',
        '/repo',
        'feature',
        'abc',
        'aip/legacyrun001',
        1,
        2,
        JSON.stringify({
          ...state.run.config,
          claude: { editMode: 'allowlist', mcp: 'isolated' },
        }),
      );
    legacy
      .prepare(
        "INSERT INTO groups (run_id, slug, position, title, task, status, pending_json, rejections_json, question, reason, warnings_json, decisions_json, conflict_files_json, merge_seq, merge_in_flight, update_on_conflict) VALUES ('legacyrun001', 'g', 0, 'G', 't', 'merged', NULL, '{}', NULL, NULL, '[]', '[]', '[]', 0, 0, 0)",
      )
      .run();
    legacy.close();
    const store = new Store(databasePath(directory));
    const loaded = store.loadRun('legacyrun001')!;
    expect(loaded.run.refStyle).toBe('branches');
    expect(loaded.groups[0]).toMatchObject({ mergeCommit: null, delivery: { state: 'pending' } });
    expect(loaded.run).toMatchObject({ title: null, name: null, namingUsage: null });
    expect(loaded.run.fromQueue).toBe(false);
    expect(loaded.run.config.claude.settings).toBe('isolated');
    expect(SCHEMA_VERSION).toBe(28);
    expect(loaded.groups[0]!.questions).toBeNull();
  });
});

describe('delivery time of a group', () => {
  it('reads an old delivery_json without finishedAt as null and keeps a stored one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    state.groups[0]!.delivery = { ...state.groups[0]!.delivery, state: 'apply_failed' };
    store.saveRun(state);
    const { finishedAt: _omit, ...old } = state.groups[0]!.delivery;
    store.database
      .prepare('UPDATE groups SET delivery_json = ? WHERE run_id = ?')
      .run(JSON.stringify(old), state.run.id);
    expect(store.loadRun(state.run.id)!.groups[0]!.delivery.finishedAt).toBeNull();
    state.groups[0]!.delivery.finishedAt = 1234;
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.groups[0]!.delivery.finishedAt).toBe(1234);
    store.close();
  });
});

describe('manual delivery mark of a group', () => {
  it('reads a delivery_json without manual as false and keeps a stored true', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    state.groups[0]!.delivery = { ...state.groups[0]!.delivery, state: 'applied', manual: true };
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.groups[0]!.delivery.manual).toBe(true);
    const { manual: _omit, ...old } = state.groups[0]!.delivery;
    store.database
      .prepare('UPDATE groups SET delivery_json = ? WHERE run_id = ?')
      .run(JSON.stringify(old), state.run.id);
    expect(store.loadRun(state.run.id)!.groups[0]!.delivery).toMatchObject({
      state: 'applied',
      manual: false,
    });
    store.close();
  });
});

describe('queue items and automatic delivery', () => {
  it('keeps true, false and null of an item', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    for (const [index, autoDeliver] of [true, false, null].entries()) {
      addItem(
        queue,
        { pipeline: 'feature', task: `t${index}`, autoDeliver: autoDeliver ?? undefined },
        `q${index}`,
        1,
      );
    }
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.items.map((item) => item.autoDeliver)).toEqual([
      true,
      false,
      null,
    ]);
  });

  it('keeps the delivery mode of an item and the autopilot answer of a queue', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', deliveryMode: 'commit' }, 'q0', 1);
    addItem(queue, { pipeline: 'feature', task: 'b' }, 'q1', 1);
    queue.autopilotAnswer = 'Согласен';
    store.saveQueue(queue);
    const loaded = store.loadQueue('/repo');
    expect(loaded?.items.map((item) => item.deliveryMode)).toEqual(['commit', null]);
    expect(loaded?.autopilotAnswer).toBe('Согласен');
    store.database.exec("UPDATE queue_items SET delivery_mode = 'tar' WHERE id = 'q0'");
    expect(store.loadQueue('/repo')?.items[0]?.deliveryMode).toBeNull();
  });

  it('keeps who answered a question and reads old decisions as human', () => {
    const store = temporaryStore();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'ok', by: 'autopilot' }, 5);
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.groups[0]?.decisions[0]?.by).toBe('autopilot');
    store.database.exec(
      `UPDATE groups SET decisions_json = '[{"stepId":"s","question":"q","answer":"a"}]'`,
    );
    expect(store.loadRun(state.run.id)?.groups[0]?.decisions[0]?.by).toBe('human');
  });

  it('keeps the attempt number of a decision and reads old decisions without it', () => {
    const store = temporaryStore();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'q' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'ok' }, 5);
    store.saveRun(state);
    expect(store.loadRun(state.run.id)?.groups[0]?.decisions[0]?.attemptSeq).toBe(1);
    store.database.exec(
      `UPDATE groups SET decisions_json = '[{"stepId":"s","question":"q","answer":"a","attemptSeq":"x"}]'`,
    );
    const old = store.loadRun(state.run.id)?.groups[0]?.decisions[0];
    expect(old).toBeDefined();
    expect(old).not.toHaveProperty('attemptSeq');
  });

  it('reads items of an older database as following the setting', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'a', autoDeliver: false }, 'q0', 1);
    old.saveQueue(queue);
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (10 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadQueue('/repo')?.items[0]?.autoDeliver).toBeNull();
  });
});

describe('repository registry', () => {
  it('fills the registry from runs and queues when migrating an older database', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const first = run(1, { now: 50 });
    first.run.repository = '/work/app';
    old.saveRun(first);
    const second = run(1, { id: 'second000001', now: 20 });
    second.run.repository = '/work/app';
    old.saveRun(second);
    old.saveQueue(emptyQueue('/work/lib', 7));
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (11 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.repositories()).toEqual([
      { path: '/work/app', addedAt: 20 },
      { path: '/work/lib', addedAt: 7 },
    ]);
  });

  it('adds a repository once and keeps its first addedAt', () => {
    const store = temporaryStore();
    expect(store.addRepository('/repo', 5)).toBe(true);
    expect(store.addRepository('/repo', 9)).toBe(false);
    expect(store.repositories()).toEqual([{ path: '/repo', addedAt: 5 }]);
  });

  it('removes only the registry entry and survives reopening', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const state = run(1);
    store.saveRun(state);
    store.addRepository(state.run.repository, 1);
    store.addRepository('/other', 2);
    store.removeRepository('/other');
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.repositories().map((entry) => entry.path)).toEqual([state.run.repository]);
    expect(reopened.loadRun(state.run.id)).not.toBeNull();
  });
});

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
    const store = temporaryStore();
    expect(store.tags()).toEqual([]);
    store.saveTag(tag('tg-a', 'auth'));
    store.saveTag({ ...tag('tg-a', 'login'), color: 'teal' });
    expect(store.tags()).toEqual([
      { id: 'tg-a', repository: '/repo', name: 'login', color: 'teal', createdAt: 5, task: null },
    ]);
  });

  it('removes a tag only in its own repository', () => {
    const store = temporaryStore();
    store.saveTag(tag('tg-a', 'auth'));
    store.saveTag({ ...tag('tg-a-2', 'auth'), repository: '/other' });
    const mine = run(1, { id: 'mine00000001' });
    mine.run.tags = ['tg-a'];
    store.saveRun(mine);
    const queue = emptyQueue('/other', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-a-2'] }, 'q1', 1);
    store.saveQueue(queue);
    store.removeTag('/repo', 'tg-a');
    expect(store.tags().map((entry) => entry.id)).toEqual(['tg-a-2']);
    expect(store.loadRun('mine00000001')!.run.tags).toEqual([]);
    // the same id on an item of another repository is not touched
    expect(store.loadQueue('/other')!.items[0]!.tags).toEqual(['tg-a', 'tg-a-2']);
    store.removeTag('/repo', 'tg-a-2');
    expect(store.tags().map((entry) => entry.id)).toEqual(['tg-a-2']);
  });

  it('keeps the source task of a linked tag across a rename and a reopen', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const linked = {
      ...tag('tg-l', 'cards'),
      color: 'indigo' as const,
      task: { run: 'r1', number: 9 },
    };
    store.saveTag(linked);
    store.saveTag({ ...linked, name: 'cards2', task: null });
    store.close();
    const again = new Store(databasePath(directory));
    expect(again.tags()).toEqual([{ ...linked, name: 'cards2' }]);
    again.close();
  });

  it('saves and reads the tags of a run and of a queue item', () => {
    const store = temporaryStore();
    const state = run(1);
    state.run.tags = ['tg-a', 'tg-b'];
    store.saveRun(state);
    state.run.tags = ['tg-b'];
    store.saveRun(state);
    expect(store.loadRun(state.run.id)!.run.tags).toEqual(['tg-b']);
    expect(store.recentRuns()[0]!.run.tags).toEqual(['tg-b']);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-a', 'tg-b']);
  });

  it('reads runs and items of an older database without tags', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const state = run(1);
    old.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x' }, 'q1', 1);
    old.saveQueue(queue);
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
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (9 + 8 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.tags()).toEqual([]);
    expect(store.loadRun(state.run.id)!.run.tags).toEqual([]);
    expect(store.loadQueue('/repo')!.items[0]!.tags).toEqual([]);
  });

  it('removes a tag from the catalog, runs (finished too) and queue items, and keeps the rest', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    store.saveTag(tag('tg-a', 'auth'));
    store.saveTag(tag('tg-b', 'v2'));
    const done = run(1, { id: 'done00000001' });
    transition(done, { kind: 'cancel', group: null }, 10);
    done.run.tags = ['tg-a', 'tg-b'];
    store.saveRun(done);
    const other = run(1, { id: 'other0000001' });
    other.run.tags = ['tg-b'];
    store.saveRun(other);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.saveQueue(queue);
    store.removeTag('/repo', 'tg-a');
    expect(store.tags().map((entry) => entry.id)).toEqual(['tg-b']);
    expect(store.loadRun('done00000001')!.run.tags).toEqual(['tg-b']);
    expect(store.loadRun('other0000001')!.run.tags).toEqual(['tg-b']);
    expect(store.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-b']);
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun('done00000001')!.run.tags).toEqual(['tg-b']);
    expect(reopened.tags().map((entry) => entry.id)).toEqual(['tg-b']);
  });
});

describe('patch of a run', () => {
  it('stores, replaces and reads the reference, and drops it with the run', () => {
    const store = temporaryStore();
    const state = run(1);
    store.saveRun(state);
    expect(store.runPatch(state.run.id)).toBeNull();
    const record = { uri: 'file:///p/a.patch', commit: 'abc', size: 10, createdAt: 5 };
    store.setRunPatch(state.run.id, record);
    expect(store.runPatch(state.run.id)).toEqual(record);
    const next = { ...record, uri: 's3://bucket/b.patch', commit: 'def' };
    store.setRunPatch(state.run.id, next);
    expect(store.runPatch(state.run.id)).toEqual(next);
    expect(store.runPatchIds()).toEqual([state.run.id]);
    store.database.prepare('DELETE FROM runs WHERE id = ?').run(state.run.id);
    expect(store.runPatch(state.run.id)).toBeNull();
    expect(store.runPatchIds()).toEqual([]);
  });

  it('migrates a database from before the table', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    old.saveRun(run(1));
    old.database.exec('DROP TABLE run_patches');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (4 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.runPatchIds()).toEqual([]);
    store.close();
  });
});

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

  function storeWithRun(): Store {
    const store = temporaryStore();
    const state = run(1);
    store.saveRun(state);
    return store;
  }

  it('keeps the id when the same attempt publishes the same file again', () => {
    const store = storeWithRun();
    const id = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    const first = store.addArtifact(record({ runId: id.id }));
    expect(first.previousUri).toBeNull();
    const second = store.addArtifact(
      record({ runId: id.id, id: 'other', size: 20, uri: 'file:///x/r1/other', createdAt: 200 }),
    );
    expect(second.previousUri).toBe('file:///x/r1/a1');
    expect(second.artifact).toMatchObject({ id: 'a1', size: 20, createdAt: 200 });
    expect(store.artifacts(id.id, 'g1')).toHaveLength(1);
    expect(store.findArtifact(id.id, 'g1', 1, 'report.md')?.id).toBe('a1');
    store.close();
  });

  it('gives a new record to another attempt and lists newest first', () => {
    const store = storeWithRun();
    const { id: runId } = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    store.addArtifact(record({ runId, id: 'a1', createdAt: 100 }));
    store.addArtifact(record({ runId, id: 'a2', seq: 2, createdAt: 100 }));
    store.addArtifact(record({ runId, id: 'a3', fileName: 'x.log', createdAt: 300 }));
    store.addArtifact(record({ runId, id: 'a4', group: 'g2', createdAt: 50 }));
    expect(store.artifacts(runId, 'g1').map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
    expect(store.artifact(runId, 'a4')?.group).toBe('g2');
    expect(store.artifact(runId, 'nope')).toBeNull();
    expect(store.artifactCount(runId, 'g1')).toBe(3);
    expect(store.artifactCount(runId, 'none')).toBe(0);
    expect(store.artifactCounts(runId)).toEqual(
      new Map([
        ['g1', { count: 3, revision: 300 + 3 * 10 }],
        ['g2', { count: 1, revision: 50 + 10 }],
      ]),
    );
    expect(store.artifactUris().get(runId)).toHaveLength(4);
    store.close();
  });

  it('migrates an older database and does not mix runs', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    old.database.exec('DROP TABLE artifacts');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - (2 + 1)}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.artifactUris().size).toBe(0);
    expect(store.artifactCounts('r1').size).toBe(0);
    store.close();
  });

  it('removes the artifacts together with their run', () => {
    const store = storeWithRun();
    const { id: runId } = store.database.prepare('SELECT id FROM runs').get() as { id: string };
    store.addArtifact(record({ runId }));
    store.database.exec('PRAGMA foreign_keys = ON');
    store.database.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    expect(store.artifactCount(runId, 'g1')).toBe(0);
    store.close();
  });
});

describe('migration to project tags', () => {
  const runSql =
    "INSERT INTO runs (id, repository, workflow, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq, tags_json) VALUES (?, ?, 'f', 'abc', 'b', ?, '{}', 0, 0, ?)";

  async function before(prepare: (database: import('node:sqlite').DatabaseSync) => void) {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../src/store/index.ts');
    const database = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -3).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3}`);
    prepare(database);
    migrate(database);
    return database;
  }

  const tagRow = (database: import('node:sqlite').DatabaseSync, id: string, name: string) =>
    database
      .prepare(
        'INSERT INTO tags (id, name, color, created_at, task_run, task_number) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, name, id === 'lk' ? 'indigo' : 'blue', 1, null, null);

  it('copies a tag into every repository it is used in, keeping the order of tags', async () => {
    const database = await before((db) => {
      tagRow(db, 'ta', 'auth');
      tagRow(db, 'tb', 'v2');
      db.prepare(runSql).run('run1', '/b', 1, JSON.stringify(['tb', 'ta']));
      db.prepare(
        "INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, updated_at) VALUES ('/a', 'stopped', 1, '[]', '[]', 1)",
      ).run();
      db.prepare(
        "INSERT INTO queue_items (id, repository, position, workflow, created_at, tags_json) VALUES ('q1', '/a', 0, 'f', 1, ?)",
      ).run(JSON.stringify(['ta']));
    });
    const tags = database
      .prepare('SELECT id, repository, name FROM tags ORDER BY id, repository')
      .all() as { id: string; repository: string; name: string }[];
    expect(tags.map((tag) => [tag.id, tag.repository])).toEqual([
      ['ta', '/a'],
      ['ta-2', '/b'],
      ['tb', '/b'],
    ]);
    const runTags = database.prepare("SELECT tags_json FROM runs WHERE id = 'run1'").get() as {
      tags_json: string;
    };
    expect(JSON.parse(runTags.tags_json)).toEqual(['tb', 'ta-2']);
    const itemTags = database
      .prepare("SELECT tags_json FROM queue_items WHERE id = 'q1'")
      .get() as {
      tags_json: string;
    };
    expect(JSON.parse(itemTags.tags_json)).toEqual(['ta']);
    database.close();
  });

  it('copies an unused tag into every known repository, or drops it without repositories', async () => {
    const two = await before((db) => {
      tagRow(db, 'tu', 'unused');
      db.prepare("INSERT INTO repositories (path, added_at) VALUES ('/b', 1), ('/a', 2)").run();
    });
    const rows = two.prepare('SELECT id, repository FROM tags ORDER BY repository').all() as {
      id: string;
      repository: string;
    }[];
    expect(rows.map((row) => [row.id, row.repository])).toEqual([
      ['tu', '/a'],
      ['tu-2', '/b'],
    ]);
    two.close();
    const none = await before((db) => tagRow(db, 'tu', 'unused'));
    expect(none.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual({ n: 0 });
    none.close();
  });

  it('puts a linked tag into the repository of its source run first, and drops it without one', async () => {
    const database = await before((db) => {
      db.prepare(
        "INSERT INTO tags (id, name, color, created_at, task_run, task_number) VALUES ('lk', 'cards', 'indigo', 1, 'src', 3)",
      ).run();
      db.prepare(
        "INSERT INTO tags (id, name, color, created_at, task_run, task_number) VALUES ('lost', 'lost', 'indigo', 1, 'gone', 4)",
      ).run();
      db.prepare(runSql).run('src', '/z', 1, '[]');
      db.prepare(runSql).run('child', '/a', 2, JSON.stringify(['lk']));
    });
    const rows = database
      .prepare('SELECT id, repository, task_run FROM tags ORDER BY repository')
      .all() as {
      id: string;
      repository: string;
      task_run: string;
    }[];
    expect(rows.map((row) => [row.id, row.repository, row.task_run])).toEqual([
      ['lk-2', '/a', 'src'],
      ['lk', '/z', 'src'],
    ]);
    const child = database.prepare("SELECT tags_json FROM runs WHERE id = 'child'").get() as {
      tags_json: string;
    };
    expect(JSON.parse(child.tags_json)).toEqual(['lk-2']);
    database.close();
  });
});

describe('finishedRunsPage', () => {
  function finished(id: string, now: number, done: boolean) {
    const state = run(1, { id, now });
    if (done) state.run.finishedAt = now + 1;
    return state;
  }

  it('pages finished runs by the (created_at, id) cursor without repeats', () => {
    const store = temporaryStore();
    store.saveRun(finished('run000000001', 10, true));
    store.saveRun(finished('run000000002', 20, true));
    store.saveRun(finished('run000000003', 20, true));
    store.saveRun(finished('run000000004', 30, true));
    store.saveRun(finished('run000000005', 40, false));
    const first = store.finishedRunsPage(2);
    expect(first.runs.map((state) => state.run.id)).toEqual(['run000000004', 'run000000003']);
    expect(first.more).toBe(true);
    const last = first.runs.at(-1)!.run;
    const second = store.finishedRunsPage(2, { createdAt: last.createdAt, id: last.id });
    expect(second.runs.map((state) => state.run.id)).toEqual(['run000000002', 'run000000001']);
    expect(second.more).toBe(false);
    store.close();
  });
});

describe('runs with pipeline actions', () => {
  const ACTIONS_CONFIG = `swarm:
  specialists:
    plan: { name: Планировщик }
    coder: { name: Кодировщик }
  actions:
    prepare: { run: make }
    commit: { run: commit }
  stages:
    before_split: [prepare]
    after_delivery: [commit]
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: code, specialist: coder }
`;

  it('saves and loads the groups of the actions apart from the groups of work', () => {
    const store = temporaryStore();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    state.actions[0]!.status = 'failed';
    state.actions[0]!.reason = 'exit code 3';
    store.saveRun(state);
    const loaded = store.loadRun(state.run.id);
    expect(loaded?.actions.map((group) => [group.slug, group.status, group.reason])).toEqual([
      ['_action-before-split-prepare', 'failed', 'exit code 3'],
    ]);
    expect(loaded?.groups).toEqual([]);
    expect(loaded?.split?.slug).toBe('_split');
    store.close();
  });

  it('keeps the attempts of a command and the delivery message', () => {
    const store = temporaryStore();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    const action = state.actions[0]!;
    action.attempts.push({
      seq: 1,
      stepId: 'prepare',
      stepIndex: 0,
      round: 1,
      specialist: 'prepare',
      runtime: 'command',
      model: null,
      status: 'failed',
      input: {
        prompt: 'make',
        groupTitle: 'prepare',
        stepId: 'prepare',
        specialistName: 'prepare',
        skills: [],
        previous: [],
        feedback: null,
        humanAnswer: null,
        decisions: [],
      },
      resumeSession: null,
      sessionId: null,
      report: null,
      reason: { kind: 'exit_code', code: 3 },
      startedAt: 1,
      finishedAt: 2,
      usage: null,
      proposal: null,
      denials: [],
      outsideChanges: [],
    });
    store.saveRun(state);
    const loaded = store.loadRun(state.run.id);
    expect(loaded?.actions[0]?.attempts[0]).toMatchObject({
      runtime: 'command',
      reason: { kind: 'exit_code', code: 3 },
    });
    store.close();
  });

  it('marks a command that was running as interrupted when the daemon starts', () => {
    const store = temporaryStore();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    dispatch([state], 1500);
    expect(state.actions[0]?.status).toBe('running');
    store.saveRun(state);
    const [recovered] = store.recover(5000);
    const action = recovered?.state.actions[0];
    expect(action?.status).toBe('failed');
    expect(action?.reason).toBe('interrupted');
    expect(recovered?.effects).toEqual([]);
    store.close();
  });

  it('loads a run saved before the actions existed', () => {
    const store = temporaryStore();
    const state = run(1);
    store.saveRun(state);
    const loaded = store.loadRun(state.run.id);
    expect(loaded?.actions).toEqual([]);
    expect(loaded?.run.config.actions).toEqual([]);
    store.close();
  });
});

describe('observers storage', () => {
  it('reads an old database: default settings and default repair', async () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    old.saveRun(run(1));
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1 - 1}`);
    old.close();
    const store = new Store(databasePath(directory));
    expect(store.loadObservers()).toEqual(defaultObserverSettings());
    expect(store.activeRuns()[0]?.run.repair).toEqual(emptyRepair());
    store.close();
  });

  it('keeps settings and the repair of a run after a restart', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = new Store(databasePath(directory));
    const settings = {
      ...defaultObserverSettings(),
      enabled: true,
      workers: 3,
      projects: [{ repository: '/repo', maxWorkers: 2 }],
      specialist: { name: 'W', timeout: '5m' },
    };
    store.saveObservers(settings);
    store.saveObservers({ ...settings, workers: 4 });
    const state = run(1);
    state.run.repair = { ...emptyRepair(), allowed: false, repairs: 1, taken: ['k'] };
    store.saveRun(state);
    state.run.repair = { ...state.run.repair, repairs: 2, cancelReason: 'stop' };
    store.saveRun(state);
    store.close();
    const again = new Store(databasePath(directory));
    expect(again.loadObservers()).toEqual({ ...settings, workers: 4 });
    expect(again.activeRuns()[0]?.run.repair).toMatchObject({
      allowed: false,
      repairs: 2,
      taken: ['k'],
      cancelReason: 'stop',
    });
    again.close();
  });
});

describe('pipeline rename', () => {
  it('opens a database with the old columns and a snapshot with the old names', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const state = run(1);
    old.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'первая' }, 'q1', 2);
    old.saveQueue(queue);
    const snapshot = JSON.parse(JSON.stringify(state.run.config)) as Record<string, unknown>;
    const pipelines = snapshot.pipelines as Record<string, unknown>[];
    delete snapshot.pipelines;
    snapshot.workflows = pipelines.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            split: { specialist: 'coder', maxGroups: 2, additionalPrompt: null, workflow: 'other' },
          }
        : entry,
    );
    old.database
      .prepare('UPDATE runs SET config_json = ? WHERE id = ?')
      .run(JSON.stringify(snapshot), state.run.id);
    renameBack(old.database);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    old.close();
    const store = new Store(databasePath(directory));
    const loaded = store.loadRun(state.run.id)!;
    expect(loaded.run.id).toBe(state.run.id);
    expect(loaded.run.pipeline).toBe(state.run.pipeline);
    const config = loaded.run.config as unknown as Record<string, unknown>;
    expect(config.workflows).toBeUndefined();
    expect(loaded.run.config.pipelines[0]?.split).toEqual({
      specialist: 'coder',
      maxGroups: 2,
      additionalPrompt: null,
      pipeline: 'other',
    });
    expect(store.loadQueue('/repo')?.items[0]).toMatchObject({ id: 'q1', pipeline: 'feature' });
    store.close();
  });
});
