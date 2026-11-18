import type { IncomingMessage, ServerResponse } from 'node:http';

import { IpcError } from '../../ipc/client/index.ts';
import { errorPage, loginPage, type SsoLink } from './pages.ts';
import { call, cookie, redirect, statusOf, type ServerGate } from './gate.ts';

/** What the login page says about the provider; `null` when none is configured or the daemon fails. */
export async function ssoLink(gate: ServerGate): Promise<SsoLink | null> {
  try {
    const result = (await call(gate, 'auth_oidc_info', {})) as { sso: SsoLink | null };
    return result.sso;
  } catch {
    return null;
  }
}

/** The login page with the SSO button when a provider is configured. */
export async function renderLogin(
  gate: ServerGate,
  response: ServerResponse,
  message?: string,
  returnTo?: string,
): Promise<void> {
  loginPage(response, message, await ssoLink(gate), returnTo);
}

function failure(response: ServerResponse, error: unknown): void {
  const unavailable =
    error instanceof IpcError &&
    ['identity.oidc_unavailable', 'identity.oidc_not_configured'].includes(error.remoteCode ?? '');
  errorPage(response, unavailable ? 503 : statusOf(error), (error as Error).message);
}

/** `GET /auth/oidc/start`: to the provider. */
export async function oidcStart(
  gate: ServerGate,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  try {
    const returnTo = url.searchParams.get('returnTo') ?? undefined;
    const { url: target } = (await call(gate, 'auth_oidc_begin', { returnTo })) as { url: string };
    redirect(response, target);
  } catch (error) {
    failure(response, error);
  }
}

/** `GET /auth/oidc/callback`: the return of the browser; the daemon checks everything. */
export async function oidcCallback(
  gate: ServerGate,
  _incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  try {
    const result = (await call(gate, 'auth_oidc_complete', { query: url.search.slice(1) })) as {
      session: string;
      expiresAt: number;
      returnTo: string;
    };
    const age = Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000));
    redirect(response, result.returnTo, { 'set-cookie': cookie(gate, result.session, age) });
  } catch (error) {
    failure(response, error);
  }
}
