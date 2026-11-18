import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Clock, Random } from '../ports/index.ts';

export const systemClock: Clock = { now: () => Date.now() };

export const systemRandom: Random = {
  token: (size) => randomBytes(size).toString('base64url'),
  id: () => randomUUID(),
};

/** SHA-256 of a secret as hex: the only form in which the database keeps sessions, tokens and codes. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The PKCE S256 challenge of a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
