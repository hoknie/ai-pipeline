import type { Database } from '../../../platform/sqlite/index.ts';

export type KnownRepository = { path: string; addedAt: number };

export class KnownRepositories {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  repositories(): KnownRepository[] {
    const rows = this.database
      .prepare('SELECT path, added_at FROM repositories ORDER BY path')
      .all() as { path: string; added_at: number }[];
    return rows.map((row) => ({ path: row.path, addedAt: row.added_at }));
  }

  /** Returns true when the repository was not in the registry yet. */
  addRepository(path: string, now: number): boolean {
    const result = this.database
      .prepare('INSERT OR IGNORE INTO repositories (path, added_at) VALUES (?, ?)')
      .run(path, now);
    return Number(result.changes) > 0;
  }

  removeRepository(path: string): void {
    this.database.prepare('DELETE FROM repositories WHERE path = ?').run(path);
  }
}
