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
