import type { IncomingMessage } from 'node:http';

import type { UserView } from '../../ipc/contract/index.ts';

export const SESSION_COOKIE = 'aip_session';

/** How long the answer of `auth_resolve` is kept: a disabled user works this long at most. */
export const RESOLVE_CACHE_MS = 10_000;

export function sessionCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || undefined;
  }
  return undefined;
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
}

export type Resolve = (credential: {
  session?: string;
  token?: string;
}) => Promise<UserView | null>;

/** Finds the user of a request by the session cookie or the bearer token; keeps answers briefly. */
export class Authenticator {
  private readonly resolve: Resolve;
  private readonly now: () => number;
  private readonly cache = new Map<string, { user: UserView; until: number }>();

  constructor(resolve: Resolve, now: () => number = () => Date.now()) {
    this.resolve = resolve;
    this.now = now;
  }

  async identify(incoming: IncomingMessage): Promise<UserView | null> {
    const token = bearerToken(incoming.headers.authorization);
    if (token !== undefined) return this.lookup(`t:${token}`, { token });
    const session = sessionCookie(incoming.headers.cookie);
    if (session !== undefined) return this.lookup(`s:${session}`, { session });
    return null;
  }

  private async lookup(
    key: string,
    credential: { session?: string; token?: string },
  ): Promise<UserView | null> {
    const cached = this.cache.get(key);
    const now = this.now();
    if (cached && cached.until > now) return cached.user;
    this.cache.delete(key);
    const user = await this.resolve(credential);
    if (user === null) return null;
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(key, { user, until: now + RESOLVE_CACHE_MS });
    return user;
  }

  /** Forgets a session after logout, so the next request does not use the cached answer. */
  forget(session: string): void {
    this.cache.delete(`s:${session}`);
  }
}
