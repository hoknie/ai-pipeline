import type { Database } from '../../../platform/sqlite/index.ts';
import type {
  Connection,
  ConnectionCheck,
  ConnectionScope,
  ConnectionState,
} from '../types/index.ts';

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
  checked_at: number | null;
  check_ok: number | null;
  check_code: string | null;
  check_count: number | null;
}

const INSERTED =
  'id, kind, name, scope, project_path, params_json, enabled, state, created_at, updated_at';
const SELECTED = `SELECT c.id, c.kind, c.name, c.scope, c.project_path, c.params_json, c.enabled, c.state,
  c.created_at, c.updated_at, k.checked_at, k.ok AS check_ok, k.code AS check_code, k.count AS check_count
  FROM integration_connections c LEFT JOIN integration_connection_checks k ON k.connection_id = c.id`;

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
    lastCheck:
      row.checked_at === null
        ? null
        : {
            at: row.checked_at,
            ok: row.check_ok === 1,
            code: row.check_code,
            count: row.check_count,
          },
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
      .prepare(`${SELECTED} ORDER BY c.created_at, c.rowid`)
      .all() as unknown as Row[];
    return rows.map(toConnection);
  }

  find(id: string): Connection | undefined {
    const row = this.database.prepare(`${SELECTED} WHERE c.id = ?`).get(id) as Row | undefined;
    return row === undefined ? undefined : toConnection(row);
  }

  /** Throws on a second connection of the same kind and name in the scope. */
  insert(connection: Connection): void {
    this.database
      .prepare(
        `INSERT INTO integration_connections (${INSERTED}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  setParams(id: string, params: Record<string, string>, now: number): void {
    this.database
      .prepare('UPDATE integration_connections SET params_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(params), now, id);
  }

  setLastCheck(id: string, check: ConnectionCheck): void {
    this.database
      .prepare(
        `INSERT INTO integration_connection_checks (connection_id, checked_at, ok, code, count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET
           checked_at = excluded.checked_at, ok = excluded.ok, code = excluded.code, count = excluded.count`,
      )
      .run(id, check.at, check.ok ? 1 : 0, check.code, check.count);
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
