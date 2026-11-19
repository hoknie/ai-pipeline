import type { Database } from '../../../platform/sqlite/index.ts';

/** The SAML assertions that were accepted; each is kept until it expires and can be accepted once. */
export class SamlAssertionsRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Stores the assertion; `false` when it is already stored (a replay). Forgets the expired ones. */
  remember(id: string, expiresAt: number, now: number): boolean {
    this.database.prepare('DELETE FROM saml_assertions WHERE expires_at <= ?').run(now);
    const result = this.database
      .prepare('INSERT OR IGNORE INTO saml_assertions (id, expires_at) VALUES (?, ?)')
      .run(id, expiresAt);
    return Number(result.changes) > 0;
  }
}
