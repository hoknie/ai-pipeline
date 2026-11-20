/**
 * Integrations: the registry of connections, the active generation of every secret, the durable
 * intents of secret operations and the claimed inbound events. No table holds a secret value.
 */
export const INTEGRATIONS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS integration_connections (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
    project_path TEXT,
    params_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'cleanup_pending')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((scope = 'project') = (project_path IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_by_name
    ON integration_connections (scope, COALESCE(project_path, ''), kind, name);
  CREATE INDEX IF NOT EXISTS integration_connections_by_project ON integration_connections (project_path);
  CREATE TABLE IF NOT EXISTS integration_secret_slots (
    connection_id TEXT NOT NULL REFERENCES integration_connections (id),
    slot TEXT NOT NULL,
    generation TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connection_id, slot)
  );
  CREATE TABLE IF NOT EXISTS integration_secret_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL REFERENCES integration_connections (id),
    slot TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('write', 'delete')),
    phase TEXT NOT NULL CHECK (phase IN ('pending_write', 'pending_cleanup', 'pending_delete')),
    previous_generation TEXT,
    next_generation TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (connection_id, slot)
  );
  CREATE TABLE IF NOT EXISTS integration_deliveries (
    connection_id TEXT NOT NULL REFERENCES integration_connections (id),
    external_event_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('processing', 'applied')),
    result_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connection_id, external_event_id)
  );
  `;

/**
 * Notifications: the subscriptions of connections to the events of projects, the outgoing queue
 * that is also the journal of deliveries, the drafts of answers collected in a chat and the read
 * position of every channel. No table holds a secret.
 */
export const NOTIFICATIONS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS notification_subscriptions (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    project_path TEXT,
    events_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notification_subscriptions_by_connection
    ON notification_subscriptions (connection_id);
  CREATE INDEX IF NOT EXISTS notification_subscriptions_by_project
    ON notification_subscriptions (project_path);
  CREATE TABLE IF NOT EXISTS notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_key TEXT NOT NULL UNIQUE,
    subscription_id TEXT NOT NULL REFERENCES notification_subscriptions (id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    run_id TEXT NOT NULL,
    group_slug TEXT,
    question_key TEXT,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed', 'closed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_attempt_at INTEGER,
    last_error TEXT,
    external_ref_json TEXT,
    closed_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (subscription_id, event_key)
  );
  CREATE INDEX IF NOT EXISTS notification_deliveries_by_due
    ON notification_deliveries (state, next_attempt_at);
  CREATE INDEX IF NOT EXISTS notification_deliveries_by_run ON notification_deliveries (run_id);
  CREATE TABLE IF NOT EXISTS notification_answers (
    delivery_id INTEGER NOT NULL REFERENCES notification_deliveries (id) ON DELETE CASCADE,
    question_index INTEGER NOT NULL,
    answer TEXT NOT NULL,
    user_ref TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (delivery_id, question_index)
  );
  CREATE TABLE IF NOT EXISTS notification_cursors (
    connection_id TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `;

/**
 * Outgoing webhooks: every attempt of a delivery with what came back, and the counter of failed
 * deliveries in a row with the reason a subscription was switched off. A response excerpt is text
 * of the receiver, never a secret of ours.
 */
export const WEBHOOKS_MIGRATION = `
  CREATE TABLE IF NOT EXISTS notification_attempts (
    delivery_id INTEGER NOT NULL REFERENCES notification_deliveries (id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    status_code INTEGER,
    error_kind TEXT,
    response_excerpt TEXT,
    PRIMARY KEY (delivery_id, n)
  );
  ALTER TABLE notification_subscriptions ADD COLUMN failure_streak INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE notification_subscriptions ADD COLUMN disabled_reason TEXT;
  `;
