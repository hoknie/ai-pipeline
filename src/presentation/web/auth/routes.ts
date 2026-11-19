import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { remoteDenied, requestSchema } from '../../ipc/contract/index.ts';
import { panel, renderPanelError } from '../errors.ts';
import { json, parseBody, readJson, send } from '../http.ts';
import { requestContext } from './context.ts';
import { call, cookie, createGate, redirect, statusOf, type ServerGate } from './gate.ts';
import { oidcCallback, oidcStart, renderLogin } from './oidc.ts';
import { samlAcs, samlMetadata, samlStart } from './saml.ts';
import { confirmCliPage, errorPage } from './pages.ts';
import { sessionCookie } from './session.ts';

export { createGate, type ServerGate };

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
  if (user === null) {
    return renderLogin(
      gate,
      response,
      'Sign in first, then run aip login again.',
      url.pathname + url.search,
    );
  }
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
  const fields = cliFields.safeParse(await formFields(incoming));
  if (user === null) {
    const back = fields.success ? `/auth/cli?${new URLSearchParams(fields.data)}` : undefined;
    return renderLogin(gate, response, 'Sign in first, then run aip login again.', back);
  }
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
    await renderLogin(gate, response);
  } else if (path === '/auth/oidc/start' && verb === 'GET') {
    await oidcStart(gate, response, url);
  } else if (path === '/auth/oidc/callback' && verb === 'GET') {
    await oidcCallback(gate, incoming, response, url);
  } else if (path === '/auth/saml/start' && verb === 'GET') {
    await samlStart(gate, response, url);
  } else if (path === '/auth/saml/acs' && verb === 'POST') {
    await samlAcs(gate, incoming, response);
  } else if (path === '/auth/saml/metadata' && verb === 'GET') {
    await samlMetadata(gate, response);
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
