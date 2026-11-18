import type { ServerResponse } from 'node:http';

import { request, IpcError } from '../../ipc/client/index.ts';
import { type Method, type ParamsOf, type UserView } from '../../ipc/contract/index.ts';
import { isSecure, type ServerModeOptions } from './proxy.ts';
import { Authenticator, SESSION_COOKIE } from './session.ts';

/** What the routes of server mode work with: the socket of the daemon and the address of the panel. */
export interface ServerGate {
  options: ServerModeOptions;
  socket: string;
  auth: Authenticator;
}

export function createGate(socket: string, options: ServerModeOptions): ServerGate {
  const resolve = async (credential: { session?: string; token?: string }) => {
    const result = (await request(socket, 'auth_resolve', credential)) as { user: UserView | null };
    return result.user;
  };
  return { options, socket, auth: new Authenticator(resolve) };
}

/** A call to the daemon as the system, or as a user. */
export function call<M extends Method>(
  gate: ServerGate,
  method: M,
  params: ParamsOf<M>,
  actor?: string,
): Promise<unknown> {
  return request(gate.socket, method, params, 30_000, actor);
}

export function cookie(gate: ServerGate, value: string, maxAgeSeconds: number): string {
  const secure = isSecure(gate.options) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function redirect(
  response: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
) {
  response.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  response.end();
}

export function statusOf(error: unknown): number {
  if (error instanceof IpcError) {
    if (error.remoteKind === 'forbidden') return 403;
    if (error.remoteKind === 'unauthorized') return 401;
  }
  return 400;
}
