import type { Database } from '../../../platform/sqlite/index.ts';

export interface SessionRecord {
  userId: string;
  expiresAt: number;
}

export class SessionsRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(hash: string, userId: string, createdAt: number, expiresAt: number): void {
    this.database
      .prepare('INSERT INTO sessions (hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hash, userId, createdAt, expiresAt);
  }

  byHash(hash: string): SessionRecord | null {
    const row = this.database
      .prepare('SELECT user_id, expires_at FROM sessions WHERE hash = ?')
      .get(hash) as { user_id: string; expires_at: number } | undefined;
    return row ? { userId: row.user_id, expiresAt: row.expires_at } : null;
  }

  remove(hash: string): void {
    this.database.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
  }

  removeOfUser(userId: string): void {
    this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  removeExpired(now: number): void {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }
}
