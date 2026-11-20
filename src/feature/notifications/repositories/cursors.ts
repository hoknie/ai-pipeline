import type { Database } from '../../../platform/sqlite/index.ts';

/** The table `notification_cursors`: how far the channel of a connection has been read. */
export class CursorRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  get(connectionId: string): string | null {
    const row = this.database
      .prepare('SELECT cursor FROM notification_cursors WHERE connection_id = ?')
      .get(connectionId) as { cursor: string } | undefined;
    return row?.cursor ?? null;
  }

  set(connectionId: string, cursor: string, now: number): void {
    this.database
      .prepare(
        `INSERT INTO notification_cursors (connection_id, cursor, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
      )
      .run(connectionId, cursor, now);
  }

  delete(connectionId: string): void {
    this.database
      .prepare('DELETE FROM notification_cursors WHERE connection_id = ?')
      .run(connectionId);
  }
}
