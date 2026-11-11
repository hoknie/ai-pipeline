/** The usage journal of the `stats` feature: its own tables, no keys into `runs`. */
export const STATS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS stats_attempts (
    run_id TEXT NOT NULL,
    group_slug TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    repository TEXT NOT NULL,
    pipeline TEXT NOT NULL,
    step_id TEXT NOT NULL,
    specialist TEXT NOT NULL,
    runtime TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL,
    PRIMARY KEY (run_id, group_slug, seq)
  );
  CREATE INDEX IF NOT EXISTS stats_attempts_by_finished ON stats_attempts (finished_at);
  CREATE INDEX IF NOT EXISTS stats_attempts_by_repository ON stats_attempts (repository, finished_at);
  CREATE TABLE IF NOT EXISTS stats_runs (
    run_id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    pipeline TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    wall_ms INTEGER NOT NULL,
    outcome TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stats_runs_by_repository ON stats_runs (repository, finished_at);
  CREATE TABLE IF NOT EXISTS stats_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    backfilled_at INTEGER
  );
  INSERT OR IGNORE INTO stats_meta (id, backfilled_at) VALUES (1, NULL);
  `;
