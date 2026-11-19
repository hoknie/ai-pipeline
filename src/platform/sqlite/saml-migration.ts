/** Sign-in by SAML: the assertions that were accepted, kept until they expire so that none is accepted twice. */
export const SAML_MIGRATION = `
  CREATE TABLE saml_assertions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX saml_assertions_by_expiry ON saml_assertions (expires_at);
  `;
