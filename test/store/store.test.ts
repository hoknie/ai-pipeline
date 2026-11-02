import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  databasePath,
  ensureDirectory,
  socketPath,
  stateDirectory,
} from '../../src/config/index.ts';
import { SCHEMA_VERSION, Store, migrate } from '../../src/store/index.ts';
import { finish, run, step } from '../core/helpers.ts';
import { addItem, emptyQueue, transition } from '../../src/core/index.ts';

function temporaryStore(): Store {
  const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
  return new Store(databasePath(directory));
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

describe('queues', () => {
  it('has no queue for an unknown repository', () => {
    const store = temporaryStore();
    expect(store.loadQueue('/repo')).toBeNull();
    expect(store.queues()).toEqual([]);
  });

  it('keeps items, order, stop and known problems', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'первая' }, 'q1', 2);
    addItem(
      queue,
      { workflow: 'feature', groups: [{ title: 'Вход', task: 'форма' }], title: 'Группы' },
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
    addItem(queue, { workflow: 'feature', task: 'A', skip: ['review', 'qa'] }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'B' }, 'q2', 3);
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')?.items.map((item) => item.skip)).toEqual([
      ['review', 'qa'],
      [],
    ]);
    store.database.prepare("UPDATE queue_items SET skip_json = '[]' WHERE id = 'q1'").run();
    expect(store.loadQueue('/repo')?.items[0]?.skip).toEqual([]);
  });

  it('keeps the dependencies of an item and the queue item of a run', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'a', after: ['r1', 'q0'] }, 'q1', 1);
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
    addItem(queue, { workflow: 'feature', task: 'a' }, 'q0', 1);
    old.saveQueue(queue);
    old.saveRun(run(1));
    old.database.exec('ALTER TABLE queue_items DROP COLUMN after_json');
    old.database.exec('ALTER TABLE runs DROP COLUMN queue_item');
    old.database.exec('ALTER TABLE queues DROP COLUMN autopilot');
    old.database.exec('ALTER TABLE queues DROP COLUMN skip_failed');
    old.database.exec('ALTER TABLE queues DROP COLUMN skipped_json');
    old.database.exec('ALTER TABLE queues DROP COLUMN autopilot_answer');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN delivery_mode');
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 4}`);
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
    queue.skipFailed = true;
    queue.skipped = ['r2', 'r1'];
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')).toMatchObject({
      autopilot: true,
      skipFailed: true,
      skipped: ['r2', 'r1'],
    });
    expect(store.queues()[0]).toEqual(queue);
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
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3}`);
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
    addItem(queue, { workflow: 'feature', task: 'первая' }, 'q1', 2);
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
  workflows:
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
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN denials_json; ALTER TABLE attempts DROP COLUMN outside_changes_json; PRAGMA user_version = 3',
    );
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([]);
    reopened.saveRun(state);
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([
      { tool: 'Bash', command: 'python3 fix.py' },
    ]);
    reopened.close();
    expect(MIGRATIONS.at(-12)).toContain('denials_json');
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
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN outside_changes_json; PRAGMA user_version = 4',
    );
    store.close();
    const reopened = new Store(databasePath(directory));
    expect(reopened.loadRun(state.run.id)!.groups[0]!.attempts[0]!.outsideChanges).toEqual([]);
    reopened.close();
    expect(MIGRATIONS.at(-11)).toContain('outside_changes_json');
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
    expect(SCHEMA_VERSION).toBe(15);
    expect(loaded.groups[0]!.questions).toBeNull();
  });
});

describe('queue items and automatic delivery', () => {
  it('keeps true, false and null of an item', () => {
    const store = temporaryStore();
    const queue = emptyQueue('/repo', 1);
    for (const [index, autoDeliver] of [true, false, null].entries()) {
      addItem(
        queue,
        { workflow: 'feature', task: `t${index}`, autoDeliver: autoDeliver ?? undefined },
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
    addItem(queue, { workflow: 'feature', task: 'a', deliveryMode: 'commit' }, 'q0', 1);
    addItem(queue, { workflow: 'feature', task: 'b' }, 'q1', 1);
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

  it('reads items of an older database as following the setting', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'a', autoDeliver: false }, 'q0', 1);
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
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 7}`);
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
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 8}`);
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
    name,
    color: 'blue' as const,
    createdAt: 5,
  });

  it('keeps the catalog and renames a tag under the same id', () => {
    const store = temporaryStore();
    expect(store.tags()).toEqual([]);
    store.saveTag(tag('tg-a', 'auth'));
    store.saveTag({ ...tag('tg-a', 'login'), color: 'teal' });
    expect(store.tags()).toEqual([{ id: 'tg-a', name: 'login', color: 'teal', createdAt: 5 }]);
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
    addItem(queue, { workflow: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.saveQueue(queue);
    expect(store.loadQueue('/repo')!.items[0]!.tags).toEqual(['tg-a', 'tg-b']);
  });

  it('reads runs and items of an older database without tags', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = new Store(databasePath(directory));
    const state = run(1);
    old.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 1);
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
    old.database.exec('ALTER TABLE queues DROP COLUMN on_limit');
    old.database.exec('ALTER TABLE queue_items DROP COLUMN run_id');
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 6}`);
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
    addItem(queue, { workflow: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 1);
    store.saveQueue(queue);
    store.removeTag('tg-a');
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
