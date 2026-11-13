import type { DatabaseSync } from 'node:sqlite';

import { STATS_MIGRATION } from './stats-migration.ts';

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
  `ALTER TABLE queue_items ADD COLUMN skip_json TEXT NOT NULL DEFAULT '[]'`,
  `
  ALTER TABLE queue_items ADD COLUMN after_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE runs ADD COLUMN queue_item TEXT;
  `,
  `
  ALTER TABLE queues ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE queues ADD COLUMN skip_failed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE queues ADD COLUMN skipped_json TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE queue_items ADD COLUMN delivery_mode TEXT;
  ALTER TABLE queues ADD COLUMN autopilot_answer TEXT;
  `,
  `
  ALTER TABLE queues ADD COLUMN on_limit TEXT NOT NULL DEFAULT 'wait';
  ALTER TABLE queue_items ADD COLUMN run_id TEXT;
  `,
  `ALTER TABLE queue_items ADD COLUMN postponed INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE runs ADD COLUMN skipped_steps_json TEXT NOT NULL DEFAULT '[]'`,
  `
  ALTER TABLE runs ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE queue_items ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE queues ADD COLUMN next_number INTEGER NOT NULL DEFAULT 1;
  UPDATE runs SET number = (
    SELECT COUNT(*) FROM runs other
    WHERE other.repository = runs.repository
      AND (other.created_at < runs.created_at OR (other.created_at = runs.created_at AND other.id <= runs.id))
  );
  UPDATE queue_items SET number = (SELECT runs.number FROM runs WHERE runs.id = queue_items.run_id)
  WHERE run_id IS NOT NULL AND EXISTS (SELECT 1 FROM runs WHERE runs.id = queue_items.run_id);
  UPDATE queue_items SET number = (
    SELECT COALESCE(MAX(runs.number), 0) FROM runs WHERE runs.repository = queue_items.repository
  ) + (
    SELECT COUNT(*) FROM queue_items other
    WHERE other.repository = queue_items.repository
      AND (other.run_id IS NULL OR NOT EXISTS (SELECT 1 FROM runs WHERE runs.id = other.run_id))
      AND (other.position < queue_items.position OR (other.position = queue_items.position AND other.id <= queue_items.id))
  )
  WHERE run_id IS NULL OR NOT EXISTS (SELECT 1 FROM runs WHERE runs.id = queue_items.run_id);
  UPDATE queues SET next_number = 1 + MAX(
    (SELECT COALESCE(MAX(number), 0) FROM runs WHERE runs.repository = queues.repository),
    (SELECT COALESCE(MAX(number), 0) FROM queue_items WHERE queue_items.repository = queues.repository)
  );
  `,
  `
  ALTER TABLE tags ADD COLUMN task_run TEXT;
  ALTER TABLE tags ADD COLUMN task_number INTEGER;
  `,
  `ALTER TABLE runs ADD COLUMN hold TEXT`,
  `ALTER TABLE queues ADD COLUMN priority_json TEXT NOT NULL DEFAULT '[]'`,
  `
  ALTER TABLE queues ADD COLUMN auto_answer INTEGER NOT NULL DEFAULT 0;
  UPDATE queues SET auto_answer = autopilot;
  `,
  `
  CREATE TABLE IF NOT EXISTS run_patches (
    run_id TEXT PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
    uri TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE groups ADD COLUMN human_only TEXT;
  `,
  `
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    group_slug TEXT NOT NULL,
    step_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    specialist TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    uri TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (run_id, group_slug, seq, file_name)
  );
  CREATE INDEX IF NOT EXISTS artifacts_group ON artifacts (run_id, group_slug);
  `,
  `
  CREATE TEMP TABLE tag_use (tag TEXT NOT NULL, repository TEXT NOT NULL, source INTEGER NOT NULL);
  INSERT INTO tag_use SELECT j.value, r.repository, 0 FROM runs r, json_each(r.tags_json) j;
  INSERT INTO tag_use SELECT j.value, q.repository, 0 FROM queue_items q, json_each(q.tags_json) j;
  INSERT INTO tag_use SELECT t.id, r.repository, 1 FROM tags t JOIN runs r ON r.id = t.task_run;
  INSERT INTO tag_use
    SELECT t.id, p.path, 0 FROM tags t, repositories p
    WHERE t.task_run IS NULL AND NOT EXISTS (SELECT 1 FROM tag_use u WHERE u.tag = t.id);
  CREATE TEMP TABLE tag_map AS
    SELECT tag, repository, CASE WHEN rn = 1 THEN tag ELSE tag || '-' || rn END AS new_id
    FROM (
      SELECT u.tag AS tag, u.repository AS repository,
             ROW_NUMBER() OVER (PARTITION BY u.tag ORDER BY u.source DESC, u.repository) AS rn
      FROM (
        SELECT tag, repository, MAX(source) AS source FROM tag_use
        WHERE tag IN (SELECT id FROM tags) GROUP BY tag, repository
      ) u
    );
  CREATE TABLE tags_split (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    task_run TEXT,
    task_number INTEGER
  );
  INSERT INTO tags_split (id, repository, name, color, created_at, task_run, task_number)
    SELECT m.new_id, m.repository, t.name, t.color, t.created_at, t.task_run, t.task_number
    FROM tag_map m JOIN tags t ON t.id = m.tag;
  UPDATE runs SET tags_json = (
    SELECT COALESCE(json_group_array(new_id ORDER BY k), '[]') FROM (
      SELECT m.new_id AS new_id, j.key AS k FROM json_each(runs.tags_json) j
      JOIN tag_map m ON m.tag = j.value AND m.repository = runs.repository
    )
  );
  UPDATE queue_items SET tags_json = (
    SELECT COALESCE(json_group_array(new_id ORDER BY k), '[]') FROM (
      SELECT m.new_id AS new_id, j.key AS k FROM json_each(queue_items.tags_json) j
      JOIN tag_map m ON m.tag = j.value AND m.repository = queue_items.repository
    )
  );
  DROP TABLE tags;
  ALTER TABLE tags_split RENAME TO tags;
  CREATE INDEX tags_by_repository ON tags (repository);
  DROP TABLE tag_map;
  DROP TABLE tag_use;
  `,
  `
  CREATE TABLE observers (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    settings_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ALTER TABLE runs ADD COLUMN repair_json TEXT;
  `,
  `
  ALTER TABLE runs RENAME COLUMN workflow TO pipeline;
  ALTER TABLE queue_items RENAME COLUMN workflow TO pipeline;
  `,
  `
  ALTER TABLE repositories ADD COLUMN name TEXT;
  ALTER TABLE repositories ADD COLUMN slug TEXT;
  ALTER TABLE repositories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE repositories ADD COLUMN color TEXT;
  CREATE UNIQUE INDEX repositories_by_slug ON repositories (slug) WHERE slug IS NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS attempts_history_order ON attempts (group_slug, started_at DESC, run_id DESC, seq DESC);
  CREATE INDEX IF NOT EXISTS runs_history_repository ON runs (repository, id);
  `,
  STATS_MIGRATION,
  `ALTER TABLE queues ADD COLUMN filter_json TEXT NOT NULL DEFAULT '{"pipelines":[],"tags":[]}'`,
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
