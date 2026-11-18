import type { Database } from '../../../platform/sqlite/index.ts';
import type { AccessToken } from '../types/index.ts';

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  start: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number;
  revoked_at: number | null;
}

const COLUMNS = 'id, user_id, name, start, created_at, last_used_at, expires_at, revoked_at';

function toToken(row: TokenRow): AccessToken {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    start: row.start,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class TokensRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(token: AccessToken, hash: string): void {
    this.database
      .prepare(
        `INSERT INTO access_tokens (id, user_id, name, hash, start, created_at, last_used_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(token.id, token.userId, token.name, hash, token.start, token.createdAt, token.expiresAt);
  }

  byHash(hash: string): AccessToken | null {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM access_tokens WHERE hash = ?`)
      .get(hash) as TokenRow | undefined;
    return row ? toToken(row) : null;
  }

  ofUser(userId: string): AccessToken[] {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM access_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at, id`,
      )
      .all(userId) as unknown as TokenRow[];
    return rows.map(toToken);
  }

  byId(id: string): AccessToken | null {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM access_tokens WHERE id = ?`)
      .get(id) as TokenRow | undefined;
    return row ? toToken(row) : null;
  }

  revoke(id: string, at: number): void {
    this.database.prepare('UPDATE access_tokens SET revoked_at = ? WHERE id = ?').run(at, id);
  }

  revokeOfUser(userId: string, at: number): void {
    this.database
      .prepare('UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(at, userId);
  }

  touch(id: string, at: number): void {
    this.database.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').run(at, id);
  }
}
