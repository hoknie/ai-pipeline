/**
 * Links of tasks. The `after` of the queue items become `blocked_by`; the first linked task tag of
 * another run on an item or a run becomes a `parent` on the run the tag belongs to. The columns
 * `after_json` and the tags stay as they are.
 */
export const TASK_LINKS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS task_links (
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source, kind, target)
  );
  CREATE INDEX IF NOT EXISTS task_links_by_target ON task_links (target);
  INSERT OR IGNORE INTO task_links (source, kind, target, position, created_at)
    SELECT q.id, 'blocked_by', j.value, j.key, q.created_at
    FROM queue_items q, json_each(q.after_json) j
    WHERE q.after_json IS NOT NULL AND json_valid(q.after_json) AND typeof(j.value) = 'text';
  INSERT OR IGNORE INTO task_links (source, kind, target, position, created_at)
    SELECT p.id, 'parent', p.parent, p.position, p.created_at FROM (
      SELECT q.id AS id, q.created_at AS created_at,
        CASE WHEN json_valid(q.after_json) THEN json_array_length(q.after_json) ELSE 0 END AS position,
        (SELECT t.task_run FROM json_each(q.tags_json) j JOIN tags t ON t.id = j.value
          WHERE t.task_run IS NOT NULL AND t.task_run <> q.id
          ORDER BY j.key LIMIT 1) AS parent
      FROM queue_items q WHERE json_valid(q.tags_json)
    ) p WHERE p.parent IS NOT NULL;
  INSERT OR IGNORE INTO task_links (source, kind, target, position, created_at)
    SELECT p.id, 'parent', p.parent, 0, p.created_at FROM (
      SELECT r.id AS id, r.created_at AS created_at,
        (SELECT t.task_run FROM json_each(r.tags_json) j JOIN tags t ON t.id = j.value
          WHERE t.task_run IS NOT NULL AND t.task_run <> r.id
          ORDER BY j.key LIMIT 1) AS parent
      FROM runs r WHERE json_valid(r.tags_json)
    ) p WHERE p.parent IS NOT NULL;
  `;
