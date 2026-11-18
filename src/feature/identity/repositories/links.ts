import type { Database } from '../../../platform/sqlite/index.ts';
import type { LoginLink } from '../types/index.ts';

interface LinkRow {
  email: string;
  name: string | null;
  admin: number;
  expires_at: number;
  used_at: number | null;
}

export interface CliCodeRecord {
  userId: string;
  challenge: string;
  machine: string;
  expiresAt: number;
  usedAt: number | null;
}

export class LoginLinksRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(hash: string, link: Omit<LoginLink, 'usedAt'>, createdAt: number): void {
    this.database
      .prepare(
        'INSERT INTO login_links (hash, email, name, admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(hash, link.email, link.name, link.admin ? 1 : 0, createdAt, link.expiresAt);
  }

  byHash(hash: string): LoginLink | null {
    const row = this.database
      .prepare('SELECT email, name, admin, expires_at, used_at FROM login_links WHERE hash = ?')
      .get(hash) as LinkRow | undefined;
    return row
      ? {
          email: row.email,
          name: row.name,
          admin: row.admin === 1,
          expiresAt: row.expires_at,
          usedAt: row.used_at,
        }
      : null;
  }

  markUsed(hash: string, at: number): void {
    this.database.prepare('UPDATE login_links SET used_at = ? WHERE hash = ?').run(at, hash);
  }
}

export class CliCodesRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(hash: string, record: Omit<CliCodeRecord, 'usedAt'>, createdAt: number): void {
    this.database
      .prepare(
        'INSERT INTO cli_login_codes (hash, user_id, challenge, machine, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(hash, record.userId, record.challenge, record.machine, createdAt, record.expiresAt);
  }

  byHash(hash: string): CliCodeRecord | null {
    const row = this.database
      .prepare(
        'SELECT user_id, challenge, machine, expires_at, used_at FROM cli_login_codes WHERE hash = ?',
      )
      .get(hash) as
      | {
          user_id: string;
          challenge: string;
          machine: string;
          expires_at: number;
          used_at: number | null;
        }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          challenge: row.challenge,
          machine: row.machine,
          expiresAt: row.expires_at,
          usedAt: row.used_at,
        }
      : null;
  }

  markUsed(hash: string, at: number): void {
    this.database.prepare('UPDATE cli_login_codes SET used_at = ? WHERE hash = ?').run(at, hash);
  }
}
