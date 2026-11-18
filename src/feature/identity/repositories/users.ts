import type { Database } from '../../../platform/sqlite/index.ts';
import {
  type Attributes,
  type User,
  type UserSource,
  type UserSubject,
  emailKey,
} from '../types/index.ts';

interface UserRow {
  id: string;
  email: string;
  name: string;
  attributes_json: string;
  source: string;
  disabled: number;
  created_at: number;
  last_login_at: number | null;
  source_issuer: string | null;
  source_subject: string | null;
}

const COLUMNS =
  'id, email, name, attributes_json, source, disabled, created_at, last_login_at, source_issuer, source_subject';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    attributes: JSON.parse(row.attributes_json) as Attributes,
    source: row.source as UserSource,
    subject:
      row.source_issuer !== null && row.source_subject !== null
        ? { issuer: row.source_issuer, subject: row.source_subject }
        : null,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export class UsersRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  all(): User[] {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM users ORDER BY created_at, id`)
      .all() as unknown as UserRow[];
    return rows.map(toUser);
  }

  byId(id: string): User | null {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as
      UserRow | undefined;
    return row ? toUser(row) : null;
  }

  byEmail(email: string): User | null {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM users WHERE email_key = ?`)
      .get(emailKey(email)) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  insert(user: User): void {
    this.database
      .prepare(
        `INSERT INTO users (id, email, email_key, name, attributes_json, source, disabled, created_at, last_login_at, source_issuer, source_subject)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.email,
        emailKey(user.email),
        user.name,
        JSON.stringify(user.attributes),
        user.source,
        user.disabled ? 1 : 0,
        user.createdAt,
        user.lastLoginAt,
        user.subject?.issuer ?? null,
        user.subject?.subject ?? null,
      );
  }

  bySubject(issuer: string, subject: string): User | null {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM users WHERE source_issuer = ? AND source_subject = ?`)
      .get(issuer, subject) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  /** Replaces what the provider owns: the email, the name and the attributes. */
  setProfile(id: string, email: string, name: string, attributes: Attributes): void {
    this.database
      .prepare(
        'UPDATE users SET email = ?, email_key = ?, name = ?, attributes_json = ? WHERE id = ?',
      )
      .run(email, emailKey(email), name, JSON.stringify(attributes), id);
  }

  /** Hands a local user over to the provider. */
  setSubject(id: string, subject: UserSubject): void {
    this.database
      .prepare(
        "UPDATE users SET source = 'oidc', source_issuer = ?, source_subject = ? WHERE id = ?",
      )
      .run(subject.issuer, subject.subject, id);
  }

  setAttributes(id: string, attributes: Attributes): void {
    this.database
      .prepare('UPDATE users SET attributes_json = ? WHERE id = ?')
      .run(JSON.stringify(attributes), id);
  }

  setDisabled(id: string, disabled: boolean): void {
    this.database.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  }

  setLastLogin(id: string, at: number): void {
    this.database.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, id);
  }
}
