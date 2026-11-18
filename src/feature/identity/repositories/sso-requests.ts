import type { Database } from '../../../platform/sqlite/index.ts';

export interface SsoRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  expiresAt: number;
}

/** The sign-ins in progress: written on the way to the provider, taken once on the way back. */
export class SsoRequestsRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  insert(request: SsoRequest, createdAt: number): void {
    this.database
      .prepare(
        `INSERT INTO sso_requests (state, nonce, code_verifier, redirect_uri, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.state,
        request.nonce,
        request.codeVerifier,
        request.redirectUri,
        request.returnTo,
        createdAt,
        request.expiresAt,
      );
  }

  /** Removes the request of the state and returns it; `null` when there is none. */
  take(state: string): SsoRequest | null {
    const row = this.database
      .prepare(
        'SELECT state, nonce, code_verifier, redirect_uri, return_to, expires_at FROM sso_requests WHERE state = ?',
      )
      .get(state) as
      | {
          state: string;
          nonce: string;
          code_verifier: string;
          redirect_uri: string;
          return_to: string;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    this.database.prepare('DELETE FROM sso_requests WHERE state = ?').run(state);
    return {
      state: row.state,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      returnTo: row.return_to,
      expiresAt: row.expires_at,
    };
  }

  removeExpired(now: number): void {
    this.database.prepare('DELETE FROM sso_requests WHERE expires_at <= ?').run(now);
  }
}
