/** Attachments of tasks: the records, and the snapshot of them in a run. */
export const ATTACHMENTS_MIGRATION = `
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    item_id TEXT,
    run_id TEXT,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    uri TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (item_id, file_name)
  );
  CREATE INDEX attachments_by_item ON attachments (item_id);
  CREATE INDEX attachments_by_run ON attachments (run_id);
  ALTER TABLE runs ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
  `;
