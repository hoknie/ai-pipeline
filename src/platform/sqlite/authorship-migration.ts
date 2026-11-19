/** The author of a task and of a run, and the journal of the actions of the server mode. Old rows have no author and are not marked as by the system. */
export const AUTHORSHIP_MIGRATION = `
  ALTER TABLE queue_items ADD COLUMN author_id TEXT;
  ALTER TABLE runs ADD COLUMN author_id TEXT;
  ALTER TABLE queue_items ADD COLUMN created_by_system INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN created_by_system INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    subject TEXT NOT NULL,
    action TEXT NOT NULL,
    repository TEXT,
    resource_kind TEXT,
    resource_id TEXT,
    outcome TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    error TEXT
  );
  CREATE INDEX audit_events_by_time ON audit_events (at DESC, id DESC);
  CREATE INDEX audit_events_by_subject ON audit_events (subject, at DESC);
  CREATE INDEX audit_events_by_repository ON audit_events (repository, at DESC);
  `;
