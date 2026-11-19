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
    state.groups[0]!.attempts[0]!.usage = { inputTokens: 12, outputTokens: 4 };
    previous.runs.saveRun(state);
    previous.database.exec(
      'DROP INDEX attempts_history_order; DROP INDEX runs_history_repository;',
    );
    dropQueueFilter(previous.database.connection);
    previous.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 15}`);
    previous.database.close();

    const migrated = openStorage(path);
    expect(migrated.runs.loadRun(state.run.id)?.groups[0]?.attempts[0]?.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
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
    expect(SCHEMA_VERSION).toBe(44);
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
    MIGRATIONS.slice(0, -19).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 19}`);
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
    addItem(queue, { pipeline: 'feature', task: 'first' }, 'q1', 2);
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 17}`);
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 16}`);
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 14}`);
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
    addItem(queue, { pipeline: 'feature', task: 'task', variant: 'light' }, 'q1', 2);
    old.queues.saveQueue(queue);
    // a database written before the variants: the column is not there, the rows are
    dropQueueFilter(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 13}`);
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
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 11}`);
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

describe('migration that removes the cost', () => {
  it('drops costUsd from the saved usage and cost_usd from the journal, keeping the tokens', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1, { id: 'cost-run' });
    step(state);
    finish(state, 'done');
    state.groups[0]!.attempts[0]!.usage = { inputTokens: 12, outputTokens: 4 };
    state.run.namingUsage = { inputTokens: 5, outputTokens: 1 };
    old.runs.saveRun(state);
    // a database of the previous version: the usage carries a cost and the journal has its column
    old.database.exec(
      `UPDATE attempts SET usage_json = json_set(usage_json, '$.costUsd', 0.001);
       UPDATE runs SET naming_usage_json = json_set(naming_usage_json, '$.costUsd', 0.002);
       ALTER TABLE stats_attempts ADD COLUMN cost_usd REAL;
       INSERT INTO stats_attempts (run_id, group_slug, seq, kind, repository, pipeline, step_id,
         specialist, runtime, status, started_at, finished_at, duration_ms, input_tokens,
         output_tokens, cost_usd)
       VALUES ('cost-run', 'g', 1, 'step', '/repo', 'feature', 'code', 'coder',
         'claude', 'finished', 1, 2, 1, 12, 4, 0.5);`,
    );
    old.database.exec(
      'ALTER TABLE attempts DROP COLUMN chain_index; ALTER TABLE attempts DROP COLUMN provider; ALTER TABLE attempts DROP COLUMN requested_provider; ALTER TABLE runs DROP COLUMN provider; ALTER TABLE queue_items DROP COLUMN provider; ALTER TABLE attempts DROP COLUMN generation; DROP TABLE saml_assertions; DROP TABLE sso_requests; DROP INDEX users_by_subject; ALTER TABLE users DROP COLUMN source_issuer; ALTER TABLE users DROP COLUMN source_subject',
    );
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 9}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    const loaded = store.runs.loadRun(state.run.id)!;
    expect(loaded.groups[0]?.attempts[0]?.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(loaded.run.namingUsage).toEqual({ inputTokens: 5, outputTokens: 1 });
    const columns = store.database.prepare('PRAGMA table_info(stats_attempts)').all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).not.toContain('cost_usd');
    expect(
      store.database.prepare('SELECT input_tokens, output_tokens FROM stats_attempts').all(),
    ).toEqual([{ input_tokens: 12, output_tokens: 4 }]);
    store.database.close();
  });
});

describe('migration to task links', () => {
  async function before(prepare: (database: import('node:sqlite').DatabaseSync) => void) {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const database = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -8).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 8}`);
    prepare(database);
    migrate(database);
    return database;
  }

  const addQueue = (db: import('node:sqlite').DatabaseSync, repository: string) =>
    db
      .prepare(
        "INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, updated_at) VALUES (?, 'stopped', 1, '[]', '[]', 1)",
      )
      .run(repository);
  const addItemRow = (
    db: import('node:sqlite').DatabaseSync,
    id: string,
    repository: string,
    position: number,
    after: string[],
    tags: string[],
  ) =>
    db
      .prepare(
        "INSERT INTO queue_items (id, repository, position, pipeline, task, created_at, tags_json, after_json) VALUES (?, ?, ?, 'f', 'task', 1, ?, ?)",
      )
      .run(id, repository, position, JSON.stringify(tags), JSON.stringify(after));
  const addRun = (
    db: import('node:sqlite').DatabaseSync,
    id: string,
    repository: string,
    tags: string[],
  ) =>
    db
      .prepare(
        "INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq, tags_json) VALUES (?, ?, 'f', 'abc', 'b', 1, '{}', 0, 0, ?)",
      )
      .run(id, repository, JSON.stringify(tags));
  const addTag = (db: import('node:sqlite').DatabaseSync, id: string, taskRun: string | null) =>
    db
      .prepare(
        "INSERT INTO tags (id, repository, name, color, created_at, task_run, task_number) VALUES (?, '/a', 'label', 'blue', 1, ?, ?)",
      )
      .run(id, taskRun, taskRun === null ? null : 3);
  const links = (db: import('node:sqlite').DatabaseSync) =>
    db
      .prepare(
        'SELECT source, kind, target, position FROM task_links ORDER BY kind, source, target',
      )
      .all() as { source: string; kind: string; target: string; position: number }[];

  it('turns the after of the items into blocked_by links in order', async () => {
    const database = await before((db) => {
      addQueue(db, '/a');
      addItemRow(db, 'q1', '/a', 0, ['q0', 'q2'], []);
      addItemRow(db, 'q2', '/a', 1, [], []);
    });
    expect(links(database)).toEqual([
      { source: 'q1', kind: 'blocked_by', target: 'q0', position: 0 },
      { source: 'q1', kind: 'blocked_by', target: 'q2', position: 1 },
    ]);
    database.close();
  });

  it('makes the first linked task tag of another task a parent, keeping an own task tag quiet', async () => {
    const database = await before((db) => {
      addTag(db, 'own', 'r1');
      addTag(db, 'foreign', 'r2');
      addTag(db, 'plain', null);
      addQueue(db, '/a');
      addRun(db, 'r1', '/a', ['own']);
      addRun(db, 'r3', '/a', ['foreign', 'own']);
      addItemRow(db, 'q1', '/a', 0, [], ['plain']);
      addItemRow(db, 'q2', '/a', 1, [], ['own', 'foreign']);
    });
    expect(links(database)).toEqual([
      { source: 'q2', kind: 'parent', target: 'r1', position: 0 },
      { source: 'r3', kind: 'parent', target: 'r2', position: 0 },
    ]);
    database.close();
  });

  it('does not duplicate the links when the database is reopened', async () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-links-')), 'aip'));
    const path = databasePath(directory);
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const legacy = new DatabaseSync(path);
    MIGRATIONS.slice(0, -8).forEach((sql) => legacy.exec(sql));
    legacy.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 8}`);
    addQueue(legacy, '/a');
    addItemRow(legacy, 'q1', '/a', 0, ['q0'], []);
    addTag(legacy, 'foreign', 'r2');
    addRun(legacy, 'r3', '/a', ['foreign']);
    legacy.close();
    const store = openStorage(path);
    const first = store.database
      .prepare('SELECT source, kind, target FROM task_links ORDER BY source, kind, target')
      .all();
    store.database.close();
    const reopened = openStorage(path);
    const second = reopened.database
      .prepare('SELECT source, kind, target FROM task_links ORDER BY source, kind, target')
      .all();
    reopened.database.close();
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
  });
});

describe('migration to the global queue', () => {
  it('gives an older database the project mode row and empty positions', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'task' }, 'q1', 2);
    old.queues.saveQueue(queue);
    dropQueueFilter(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 12}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    const row = store.database.prepare('SELECT * FROM global_queue').all() as Record<
      string,
      unknown
    >[];
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ id: 1, status: 'stopped', applied_scope: 'project' });
    const positions = store.database.prepare('SELECT global_position FROM queue_items').all() as {
      global_position: number | null;
    }[];
    expect(positions).toEqual([{ global_position: null }]);
    expect(store.queues.loadQueue('/repo')?.items).toHaveLength(1);
    store.database.close();
  });
});

describe('migration to the chain item of an attempt', () => {
  async function before(prepare: (database: import('node:sqlite').DatabaseSync) => void, back = 7) {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const database = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -back).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - back}`);
    prepare(database);
    migrate(database);
    return database;
  }

  it('adds nullable chain_index and provider, leaving the old attempts with NULL', async () => {
    const database = await before((db) => {
      db.prepare(
        "INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq) VALUES ('old-run', '/repo', 'f', 'abc', 'b', 1, '{}', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO groups (run_id, slug, position, title, task, status, rejections_json, warnings_json, decisions_json, conflict_files_json, merge_in_flight, update_on_conflict) VALUES ('old-run', 'g', 0, 'G', 't', 'queued', '{}', '[]', '[]', '[]', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO attempts (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, status, input_json, started_at) VALUES ('old-run', 'g', 1, 'code', 0, 1, 'coder', 'claude', 'failed', '{}', 1)",
      ).run();
    });
    const row = database.prepare('SELECT * FROM attempts').get() as Record<string, unknown>;
    expect(row).toMatchObject({ chain_index: null, provider: null, seq: 1 });
    database.close();
  });

  it('adds nullable provider to runs and tasks, and requested_provider to attempts, leaving old rows with NULL', async () => {
    const database = await before((db) => {
      db.prepare(
        "INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq) VALUES ('old-run', '/repo', 'f', 'abc', 'b', 1, '{}', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO groups (run_id, slug, position, title, task, status, rejections_json, warnings_json, decisions_json, conflict_files_json, merge_in_flight, update_on_conflict) VALUES ('old-run', 'g', 0, 'G', 't', 'queued', '{}', '[]', '[]', '[]', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO attempts (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, status, input_json, started_at) VALUES ('old-run', 'g', 1, 'code', 0, 1, 'coder', 'claude', 'failed', '{}', 1)",
      ).run();
      db.prepare(
        "INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, updated_at) VALUES ('/repo', 'stopped', 1, '[]', '[]', 1)",
      ).run();
      db.prepare(
        "INSERT INTO queue_items (id, repository, position, pipeline, task, created_at) VALUES ('q1', '/repo', 0, 'f', 't', 1)",
      ).run();
    }, 5);
    expect(database.prepare('SELECT provider FROM runs').get()).toEqual({ provider: null });
    expect(database.prepare('SELECT provider FROM queue_items').get()).toEqual({ provider: null });
    expect(database.prepare('SELECT requested_provider FROM attempts').get()).toEqual({
      requested_provider: null,
    });
    database.close();
  });
});

describe('migration to the generation of a conversation', () => {
  async function before(prepare: (database: import('node:sqlite').DatabaseSync) => void) {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const database = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -5).forEach((sql) => database.exec(sql));
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 5}`);
    prepare(database);
    migrate(database);
    return database;
  }

  it('adds a nullable generation and leaves the attempts of an older database with NULL', async () => {
    const database = await before((db) => {
      db.prepare(
        "INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq) VALUES ('old-run', '/repo', 'f', 'abc', 'b', 1, '{}', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO groups (run_id, slug, position, title, task, status, rejections_json, warnings_json, decisions_json, conflict_files_json, merge_in_flight, update_on_conflict) VALUES ('old-run', 'g', 0, 'G', 't', 'queued', '{}', '[]', '[]', '[]', 0, 0)",
      ).run();
      db.prepare(
        "INSERT INTO attempts (run_id, group_slug, seq, step_id, step_index, round, specialist, runtime, status, input_json, started_at) VALUES ('old-run', 'g', 1, 'code', 0, 1, 'coder', 'claude', 'failed', '{}', 1)",
      ).run();
    });
    const row = database.prepare('SELECT * FROM attempts').get() as Record<string, unknown>;
    expect(row).toMatchObject({ generation: null, seq: 1, runtime: 'claude' });
    const column = (
      database.prepare('PRAGMA table_info(attempts)').all() as { name: string; notnull: number }[]
    ).find((entry) => entry.name === 'generation');
    expect(column?.notnull).toBe(0);
    database.close();
  });

  it('reads old attempts as null and keeps a new generation after the database is reopened', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-generation-')), 'aip'));
    const path = databasePath(directory);
    const first = openStorage(path);
    const state = run(1, { id: 'generation-run' });
    step(state);
    const attempts = state.groups[0]!.attempts;
    attempts[0]!.generation = null;
    first.runs.saveRun(state);
    first.database.close();

    const second = openStorage(path);
    const loaded = second.runs.loadRun(state.run.id)!;
    expect(loaded.groups[0]!.attempts[0]!.generation).toBeNull();
    loaded.groups[0]!.attempts[0]!.generation = 7;
    loaded.groups[0]!.attempts[0]!.runtime = 'codex';
    second.runs.saveRun(loaded);
    second.database.close();

    const third = openStorage(path);
    const again = third.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!;
    expect(again.generation).toBe(7);
    expect(again.runtime).toBe('codex');
    third.database.close();
  });

  it('writes the generation inside the transaction of the run and rolls it back with it', () => {
    const store = temporaryStorage();
    const state = run(1, { id: 'rollback-run' });
    step(state);
    store.runs.saveRun(state);
    const changed = structuredClone(state);
    changed.groups[0]!.attempts[0]!.generation = 3;
    expect(() =>
      store.database.transaction(() => {
        store.runs.writeRun(changed);
        throw new Error('the transition failed');
      }),
    ).toThrow('the transition failed');
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.generation).toBeNull();
    store.database.transaction(() => store.runs.writeRun(changed));
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.generation).toBe(3);
    store.database.close();
  });
});

describe('sign-in by a provider', () => {
  it('stores the subject of a user and the requests in progress', () => {
    const store = temporaryStorage();
    const insert = store.database.connection.prepare(
      "INSERT INTO users (id, email, email_key, name, source, source_issuer, source_subject, created_at) VALUES (?, ?, ?, 'n', 'oidc', ?, ?, 1)",
    );
    insert.run('1', 'a@corp.com', 'a@corp.com', 'https://i', '42');
    insert.run('2', 'b@corp.com', 'b@corp.com', 'https://other', '42');
    expect(() => insert.run('3', 'c@corp.com', 'c@corp.com', 'https://i', '42')).toThrow(/UNIQUE/);
    store.database.connection
      .prepare(
        "INSERT INTO users (id, email, email_key, name, created_at) VALUES ('4', 'd@x.io', 'd@x.io', 'd', 1)",
      )
      .run();
    store.database.connection
      .prepare(
        "INSERT INTO users (id, email, email_key, name, created_at) VALUES ('5', 'e@x.io', 'e@x.io', 'e', 1)",
      )
      .run();
    const columns = store.database.connection.prepare('PRAGMA table_info(sso_requests)').all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).toEqual([
      'state',
      'nonce',
      'code_verifier',
      'redirect_uri',
      'return_to',
      'created_at',
      'expires_at',
    ]);
    store.database.close();
  });
});

describe('migration of an identity database to sign-in by a provider', () => {
  it('adds the subject columns, the index and sso_requests, keeping the users', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const old = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -2).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 2}`);
    old
      .prepare(
        "INSERT INTO users (id, email, email_key, name, created_at) VALUES ('u1', 'a@x.io', 'a@x.io', 'a', 1)",
      )
      .run();
    migrate(old);
    const columns = (old.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).toEqual(expect.arrayContaining(['source_issuer', 'source_subject']));
    const names = (
      old
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('users_by_subject', 'sso_requests')",
        )
        .all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names.sort()).toEqual(['sso_requests', 'users_by_subject']);
    expect(old.prepare('SELECT id, source_issuer, source_subject FROM users').all()).toEqual([
      { id: 'u1', source_issuer: null, source_subject: null },
    ]);
    old.close();
  });
});

describe('migration of a database to sign-in by SAML', () => {
  it('adds saml_assertions to the previous version and keeps the users', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const old = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -1).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    old
      .prepare(
        "INSERT INTO users (id, email, email_key, name, created_at) VALUES ('u1', 'a@x.io', 'a@x.io', 'a', 1)",
      )
      .run();
    migrate(old);
    const columns = (old.prepare('PRAGMA table_info(saml_assertions)').all() as { name: string }[])
      .map((column) => column.name)
      .sort();
    expect(columns).toEqual(['expires_at', 'id']);
    old.prepare("INSERT INTO saml_assertions (id, expires_at) VALUES ('a1', 10)").run();
    expect(() =>
      old.prepare("INSERT INTO saml_assertions (id, expires_at) VALUES ('a1', 20)").run(),
    ).toThrow(/UNIQUE/);
    expect(old.prepare('SELECT id FROM users').all()).toEqual([{ id: 'u1' }]);
    old.close();
  });
});
