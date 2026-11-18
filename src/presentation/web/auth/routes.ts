import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { request, IpcError } from '../../ipc/client/index.ts';
import {
  type Method,
  type ParamsOf,
  remoteDenied,
  requestSchema,
  type UserView,
} from '../../ipc/contract/index.ts';
import { panel, renderPanelError } from '../errors.ts';
import { json, parseBody, readJson, send } from '../http.ts';
import { requestContext } from './context.ts';
import { confirmCliPage, errorPage, loginPage } from './pages.ts';
import { isSecure, type ServerModeOptions } from './proxy.ts';
import { Authenticator, SESSION_COOKIE, sessionCookie } from './session.ts';

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

function cookie(gate: ServerGate, value: string, maxAgeSeconds: number): string {
  const secure = isSecure(gate.options) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function redirect(
  response: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
) {
  response.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  response.end();
}

function statusOf(error: unknown): number {
  if (error instanceof IpcError) {
    if (error.remoteKind === 'forbidden') return 403;
    if (error.remoteKind === 'unauthorized') return 401;
  }
  return 400;
}

async function formFields(incoming: IncomingMessage): Promise<Record<string, string>> {
  let text = '';
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    text += chunk.toString('utf8');
    if (text.length > 16 * 1024) throw panel('too_large', 'request body is too large');
  }
  return Object.fromEntries(new URLSearchParams(text));
}

const cliFields = z.object({
  port: z.string().regex(/^\d{4,5}$/),
  state: z.string().min(8).max(128),
  challenge: z.string().min(1).max(128),
  machine: z.string().min(1).max(128),
});

async function linkLogin(gate: ServerGate, response: ServerResponse, code: string): Promise<void> {
  try {
    const result = (await call(gate, 'auth_link_login', { code })) as {
      session: string;
      expiresAt: number;
    };
    const age = Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000));
    redirect(response, '/', { 'set-cookie': cookie(gate, result.session, age) });
  } catch (error) {
    errorPage(response, statusOf(error), (error as Error).message);
  }
}

async function logout(gate: ServerGate, incoming: IncomingMessage, response: ServerResponse) {
  const session = sessionCookie(incoming.headers.cookie);
  if (session !== undefined) {
    gate.auth.forget(session);
    await call(gate, 'auth_logout', { session });
  }
  send(response, 200, JSON.stringify({ ok: true }), 'application/json', {
    'set-cookie': cookie(gate, '', 0),
  });
}

async function cliConfirm(
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const user = await gate.auth.identify(incoming);
  if (user === null) return loginPage(response, 'Sign in first, then run aip login again.');
  const fields = cliFields.safeParse(Object.fromEntries(url.searchParams));
  if (!fields.success) return errorPage(response, 400, 'The login request is not valid.');
  try {
    await call(gate, 'cli_login_begin', fields.data, user.id);
  } catch (error) {
    return errorPage(response, statusOf(error), (error as Error).message);
  }
  confirmCliPage(response, fields.data, user.email);
}

async function cliApprove(
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const user = await gate.auth.identify(incoming);
  if (user === null) return loginPage(response, 'Sign in first, then run aip login again.');
  const fields = cliFields.safeParse(await formFields(incoming));
  if (!fields.success) return errorPage(response, 400, 'The login request is not valid.');
  try {
    const { port, state, ...rest } = fields.data;
    const approved = (await call(gate, 'cli_login_approve', rest, user.id)) as { code: string };
    redirect(
      response,
      `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(approved.code)}&state=${encodeURIComponent(state)}`,
    );
  } catch (error) {
    errorPage(response, statusOf(error), (error as Error).message);
  }
}

const exchangeBody = z.object({ code: z.string().min(1), verifier: z.string().min(1) });

/** Tries the `/auth/*` routes; false when the path is none of them. */
export async function authRoute(
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const verb = incoming.method ?? 'GET';
  const path = url.pathname;
  const link = /^\/auth\/link\/([^/]+)$/.exec(path);
  if (link && verb === 'GET') {
    await linkLogin(gate, response, decodeURIComponent(link[1] as string));
  } else if (path === '/auth/login' && verb === 'GET') {
    loginPage(response);
  } else if (path === '/auth/logout' && verb === 'POST') {
    await logout(gate, incoming, response);
  } else if (path === '/auth/cli' && verb === 'GET') {
    await cliConfirm(gate, incoming, response, url);
  } else if (path === '/auth/cli' && verb === 'POST') {
    await cliApprove(gate, incoming, response);
  } else if (path === '/auth/cli/token' && verb === 'POST') {
    const body = parseBody(exchangeBody, await readJson(incoming));
    json(response, 200, await call(gate, 'cli_login_exchange', body));
  } else if (path.startsWith('/auth/')) {
    send(response, 404, 'not found', 'text/plain');
  } else {
    return false;
  }
  return true;
}

/** `POST /api/ipc`: a method of the daemon for the user of the session or the token. */
export async function ipcRoute(
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJson(incoming)) as { method?: unknown; params?: unknown } | null;
  const method = typeof body?.method === 'string' ? body.method : '';
  if (remoteDenied.includes(method))
    throw panel('forbidden', `${method} is not available remotely`);
  const parsed = requestSchema.safeParse({ method, params: body?.params ?? {} });
  if (!parsed.success) throw panel('invalid', z.prettifyError(parsed.error));
  const actor = requestContext.getStore()?.actor;
  try {
    const result = await call(gate, parsed.data.method, parsed.data.params as never, actor);
    json(response, 200, result ?? null);
  } catch (error) {
    const rendered = renderPanelError(error);
    json(response, rendered.status, rendered.body);
  }
}
