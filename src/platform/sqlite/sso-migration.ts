/** Sign-in by an external provider: the subject of a user and the sign-ins in progress at the provider (one row per redirect, used once). */
export const SSO_MIGRATION = `
  ALTER TABLE users ADD COLUMN source_issuer TEXT;
  ALTER TABLE users ADD COLUMN source_subject TEXT;
  CREATE UNIQUE INDEX users_by_subject ON users (source_issuer, source_subject)
    WHERE source_issuer IS NOT NULL;
  CREATE TABLE sso_requests (
    state TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    return_to TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `;
