import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION, migrate } from '../../../src/platform/sqlite/index.ts';
import {
  dropProjectAttributes,
  dropQueueFilter,
  openStorage,
  renameBack,
  temporaryStorage,
} from '../../feature/storage.ts';
import { finish, run, step } from '../../feature/runs/helpers.ts';
import { addItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';

describe('migrations', () => {
  it('sets the schema version and changes nothing when run again', () => {
    const store = temporaryStorage();
    const version = () =>
      (store.database.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version;
    expect(version()).toBe(SCHEMA_VERSION);
    const tables = () =>
      store.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
    const before = tables();
    migrate(store.database.connection);
    expect(version()).toBe(SCHEMA_VERSION);
    expect(tables()).toEqual(before);
    const mode = store.database.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
  });

  it('adds history indexes to an older database without changing saved attempts and usage', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-history-')), 'aip'));
    const path = databasePath(directory);
    const previous = openStorage(path);
    const state = run(1, { id: 'old-history-run' });
    step(state);
    finish(state, 'done');
    state.groups[0]!.attempts[0]!.usage = { inputTokens: 12, outputTokens: 4, costUsd: 0.001 };
    previous.runs.saveRun(state);
    previous.database.exec(
      'DROP INDEX attempts_history_order; DROP INDEX runs_history_repository;',
    );
    dropQueueFilter(previous.database.connection);
    previous.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    previous.database.close();

    const migrated = openStorage(path);
    expect(migrated.runs.loadRun(state.run.id)?.groups[0]?.attempts[0]?.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      costUsd: 0.001,
    });
    const indexes = migrated.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('attempts_history_order', 'runs_history_repository') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(indexes.map((index) => index.name)).toEqual([
      'attempts_history_order',
      'runs_history_repository',
    ]);
    migrated.database.close();

    const reopened = openStorage(path);
    expect(reopened.runs.loadRun(state.run.id)?.groups[0]?.attempts[0]?.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      costUsd: 0.001,
    });
    reopened.database.close();
  });
});

describe('migration to hidden refs', () => {
  it('keeps runs created before the change on visible branches', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
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
    const store = openStorage(databasePath(directory));
    const loaded = store.runs.loadRun('legacyrun001')!;
    expect(loaded.run.refStyle).toBe('branches');
    expect(loaded.groups[0]).toMatchObject({ mergeCommit: null, delivery: { state: 'pending' } });
    expect(loaded.run).toMatchObject({ title: null, name: null, namingUsage: null });
    expect(loaded.run.fromQueue).toBe(false);
    expect(loaded.run.config.claude.settings).toBe('isolated');
    expect(SCHEMA_VERSION).toBe(34);
    expect(loaded.groups[0]!.questions).toBeNull();
  });
});

describe('migration to project tags', () => {
  const runSql =
    "INSERT INTO runs (id, repository, workflow, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq, tags_json) VALUES (?, ?, 'f', 'abc', 'b', ?, '{}', 0, 0, ?)";

  async function before(prepare: (database: import('node:sqlite').DatabaseSync) => void) {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const database = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -9).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 9}`);
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

describe('pipeline rename', () => {
  it('opens a database with the old columns and a snapshot with the old names', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1);
    old.runs.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'первая' }, 'q1', 2);
    old.queues.saveQueue(queue);
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
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 7}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    const loaded = store.runs.loadRun(state.run.id)!;
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
    expect(store.queues.loadQueue('/repo')?.items[0]).toMatchObject({
      id: 'q1',
      pipeline: 'feature',
    });
    store.database.close();
  });
});

describe('project attributes', () => {
  it('keeps the registry of an older database, every project enabled and without a slug yet', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    old.known.addRepository('/work/app', 5);
    old.known.addRepository('/a/app', 9);
    dropQueueFilter(old.database.connection);
    dropProjectAttributes(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 6}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(
      store.database
        .prepare(
          'SELECT path, added_at, name, slug, enabled, color FROM repositories ORDER BY path',
        )
        .all(),
    ).toEqual([
      { path: '/a/app', added_at: 9, name: null, slug: null, enabled: 1, color: null },
      { path: '/work/app', added_at: 5, name: null, slug: null, enabled: 1, color: null },
    ]);
    store.database.close();
  });
});

describe('migration to the usage journal', () => {
  it('adds the stats tables to an older database and keeps its runs', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1, { id: 'stats-run' });
    step(state);
    old.runs.saveRun(state);
    old.database.exec('DROP TABLE stats_attempts; DROP TABLE stats_runs; DROP TABLE stats_meta;');
    dropQueueFilter(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 4}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    const names = (type: string) =>
      (
        store.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = ? AND name LIKE 'stats_%' ORDER BY name",
          )
          .all(type) as { name: string }[]
      ).map((row) => row.name);
    expect(names('table')).toEqual(['stats_attempts', 'stats_meta', 'stats_runs']);
    expect(names('index')).toEqual(
      expect.arrayContaining([
        'stats_attempts_by_finished',
        'stats_attempts_by_repository',
        'stats_runs_by_repository',
      ]),
    );
    expect(store.runs.loadRun(state.run.id)?.run.id).toBe(state.run.id);
    store.database.close();
  });
});

describe('migration to pipeline variants', () => {
  it('gives the runs and the queued tasks of an older database the variant default', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1, { id: 'variant-run' });
    old.runs.saveRun(state);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'задача', variant: 'light' }, 'q1', 2);
    old.queues.saveQueue(queue);
    // a database written before the variants: the column is not there, the rows are
    dropQueueFilter(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 3}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.runs.loadRun('variant-run')?.run.variant).toBe('default');
    expect(store.queues.loadQueue('/repo')?.items[0]?.variant).toBe('default');
    store.database.close();
  });
});

describe('migration to attachments', () => {
  it('adds the table and gives the runs of an older database an empty list', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1);
    old.runs.saveRun(state);
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.runs.loadRun(state.run.id)?.run.attachments).toEqual([]);
    const columns = store.database.prepare('PRAGMA table_info(attachments)').all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'item_id', 'run_id', 'file_name', 'size', 'media_type', 'uri']),
    );
    store.database.close();
  });
});
