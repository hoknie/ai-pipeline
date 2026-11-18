import { post } from '../../shared/api/http.ts';

export interface Me {
  email: string;
  name: string;
  admin: boolean;
}

export interface TokenRow {
  id: string;
  name: string;
  start: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  source: string;
  attributes: Record<string, string[]>;
  disabled: boolean;
  admin: boolean;
  lastLoginAt: number | null;
}

/** A method of the daemon through the panel: the panel adds the user of the session. */
function ipc<T>(method: string, params: object = {}): Promise<T> {
  return post<T>('/api/ipc', { method, params });
}

/** The mode of the panel and the signed in user; `me` is null in the local mode. */
export async function loadSystemMe(): Promise<{ mode: 'local' | 'server'; me: Me | null }> {
  try {
    const response = await fetch('/api/system', { credentials: 'same-origin' });
    if (!response.ok) return { mode: 'local', me: null };
    const body = (await response.json()) as { mode?: 'local' | 'server'; me?: Me | null };
    return { mode: body.mode ?? 'local', me: body.me ?? null };
  } catch {
    return { mode: 'local', me: null };
  }
}

export const listTokens = async (): Promise<TokenRow[]> =>
  (await ipc<{ tokens: TokenRow[] }>('tokens_list')).tokens;

export const createToken = (
  name: string,
  ttl: string,
): Promise<{ value: string; token: TokenRow }> => ipc('tokens_create', { name, ttl });

export const revokeToken = (token: string): Promise<unknown> => ipc('tokens_revoke', { token });

export const listUsers = async (): Promise<UserRow[]> =>
  (await ipc<{ users: UserRow[] }>('users_list')).users;

export const setUserDisabled = (email: string, disabled: boolean): Promise<unknown> =>
  ipc(disabled ? 'users_disable' : 'users_enable', { email });

export const signOut = (): Promise<unknown> => post('/auth/logout');
