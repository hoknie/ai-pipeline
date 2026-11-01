import type { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    workflow TEXT NOT NULL,
    base_commit TEXT NOT NULL,
    branch TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    config_json TEXT NOT NULL,
    dirty_warning INTEGER NOT NULL,
    next_merge_seq INTEGER NOT NULL
  );
  CREATE INDEX runs_by_created ON runs (created_at);
  CREATE TABLE groups (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    pending_json TEXT,
    rejections_json TEXT NOT NULL,
    question TEXT,
    reason TEXT,
    warnings_json TEXT NOT NULL,
    decisions_json TEXT NOT NULL,
    conflict_files_json TEXT NOT NULL,
    merge_seq INTEGER,
    merge_in_flight INTEGER NOT NULL,
    update_on_conflict INTEGER NOT NULL,
    PRIMARY KEY (run_id, slug)
  );
  CREATE TABLE attempts (
    run_id TEXT NOT NULL,
    group_slug TEXT NOT NULL,
    seq INTEGER NOT NULL,
    step_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    round INTEGER NOT NULL,
    specialist TEXT NOT NULL,
    runtime TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    resume_session TEXT,
    session_id TEXT,
    report_json TEXT,
    reason_json TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    usage_json TEXT,
    proposal_json TEXT,
    PRIMARY KEY (run_id, group_slug, seq),
    FOREIGN KEY (run_id, group_slug) REFERENCES groups (run_id, slug) ON DELETE CASCADE
  );
  `,
  `
  ALTER TABLE runs ADD COLUMN ref_style TEXT NOT NULL DEFAULT 'branches';
  ALTER TABLE groups ADD COLUMN merge_commit TEXT;
  ALTER TABLE groups ADD COLUMN delivery_json TEXT;
  ALTER TABLE runs ADD COLUMN pending_delivery_json TEXT;
  `,
  `
  ALTER TABLE runs ADD COLUMN title TEXT;
  ALTER TABLE runs ADD COLUMN name TEXT;
  ALTER TABLE runs ADD COLUMN naming_usage_json TEXT;
  `,
  `
  ALTER TABLE attempts ADD COLUMN denials_json TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE attempts ADD COLUMN outside_changes_json TEXT NOT NULL DEFAULT '[]';
  `,
  `
  CREATE TABLE queues (
    repository TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    parallel INTEGER NOT NULL,
    runs_json TEXT NOT NULL,
    acknowledged_json TEXT NOT NULL,
    stop_json TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE queue_items (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL REFERENCES queues (repository) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    workflow TEXT NOT NULL,
    task TEXT,
    groups_json TEXT,
    title TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX queue_items_by_position ON queue_items (repository, position);
  ALTER TABLE runs ADD COLUMN from_queue INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE groups ADD COLUMN questions_json TEXT;
  `,
  `
  CREATE TABLE repositories (
    path TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO repositories (path, added_at)
    SELECT repository, MIN(created_at) FROM runs GROUP BY repository;
  INSERT OR IGNORE INTO repositories (path, added_at)
    SELECT repository, updated_at FROM queues;
  `,
  `ALTER TABLE queue_items ADD COLUMN auto_deliver INTEGER`,
  `
  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE runs ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE queue_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(database: DatabaseSync): void {
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[version] ?? '');
      database.exec(`PRAGMA user_version = ${version + 1}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
