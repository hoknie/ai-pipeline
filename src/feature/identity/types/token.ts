export const TOKEN_PREFIX = 'aip_pat_';

/** How many characters of a token the list shows. */
export const TOKEN_SHOWN = 12;

const TOKEN_FORMAT = /^aip_pat_[A-Za-z0-9_-]{43}$/;

export function isTokenFormat(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}

export function tokenStart(value: string): string {
  return value.slice(0, TOKEN_SHOWN);
}

export interface AccessToken {
  id: string;
  userId: string;
  name: string;
  /** The first characters of the value. */
  start: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
  revokedAt: number | null;
}

/** A login code of `aip login` or a login link, as stored. */
export interface LoginLink {
  email: string;
  name: string | null;
  admin: boolean;
  expiresAt: number;
  usedAt: number | null;
}
