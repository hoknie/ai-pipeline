import type { Database } from '../../../platform/sqlite/index.ts';
import type { Connection, ConnectionScope, ConnectionState } from '../types/index.ts';

interface Row {
  id: string;
  kind: string;
  name: string;
  scope: string;
  project_path: string | null;
  params_json: string;
  enabled: number;
  state: string;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  'id, kind, name, scope, project_path, params_json, enabled, state, created_at, updated_at';

function toConnection(row: Row): Connection {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scope: row.scope as ConnectionScope,
    projectPath: row.project_path,
    params: JSON.parse(row.params_json) as Record<string, string>,
    enabled: row.enabled === 1,
    state: row.state as ConnectionState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The table `integration_connections`; every method is one statement, transactions are the caller's. */
export class ConnectionRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  all(): Connection[] {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM integration_connections ORDER BY created_at, rowid`)
      .all() as unknown as Row[];
    return rows.map(toConnection);
  }

  find(id: string): Connection | undefined {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM integration_connections WHERE id = ?`)
      .get(id) as Row | undefined;
    return row === undefined ? undefined : toConnection(row);
  }

  /** Throws on a second connection of the same kind and name in the scope. */
  insert(connection: Connection): void {
    this.database
      .prepare(
        `INSERT INTO integration_connections (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connection.id,
        connection.kind,
        connection.name,
        connection.scope,
        connection.projectPath,
        JSON.stringify(connection.params),
        connection.enabled ? 1 : 0,
        connection.state,
        connection.createdAt,
        connection.updatedAt,
      );
  }

  setEnabled(id: string, enabled: boolean, now: number): void {
    this.database
      .prepare('UPDATE integration_connections SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id);
  }

  /** The tombstone of a removal: the connection stops working and waits for its cleanup. */
  tombstone(id: string, now: number): void {
    this.database
      .prepare(
        "UPDATE integration_connections SET enabled = 0, state = 'cleanup_pending', updated_at = ? WHERE id = ?",
      )
      .run(now, id);
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM integration_connections WHERE id = ?').run(id);
  }

  /** The connections of a project that moved keep their ids and secrets. */
  moveProject(from: string, to: string): void {
    this.database
      .prepare('UPDATE integration_connections SET project_path = ? WHERE project_path = ?')
      .run(to, from);
  }

  countOfProject(path: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS total FROM integration_connections WHERE project_path = ?')
      .get(path) as { total: number };
    return row.total;
  }
}
