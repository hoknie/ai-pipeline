import type { ServerResponse } from 'node:http';

import { send } from '../http.ts';

function escape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const STYLE =
  'body{font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}button{font:inherit;padding:.5rem 1rem}a.button{display:inline-block;padding:.5rem 1rem;border:1px solid #888;border-radius:4px;color:inherit;text-decoration:none}code{background:#eee;padding:0 .25rem}';

/** A small server-rendered page: it works without a session and without the panel bundle. */
export function sendPage(
  response: ServerResponse,
  status: number,
  title: string,
  body: string,
  headers: Record<string, string> = {},
): void {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} - aip</title><style>${STYLE}</style></head><body><h1>${escape(title)}</h1>${body}</body></html>`;
  send(response, status, html, 'text/html', { 'content-security-policy': POLICY, ...headers });
}

/** The sign-in through a provider: its caption and whether the daemon can use it. */
export interface SsoLink {
  label: string;
  ready: boolean;
  unavailable?: boolean;
}

function ssoBlock(sso: SsoLink | null | undefined, returnTo?: string): string {
  if (!sso) return '';
  if (!sso.ready) return '<p>Sign-in through SSO is not configured on this server.</p>';
  const target = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  const notice = sso.unavailable ? '<p>SSO provider is not available. Try again later.</p>' : '';
  return `${notice}<p><a class="button" href="/auth/oidc/start${escape(target)}">Sign in with ${escape(sso.label)}</a></p>`;
}

export function loginPage(
  response: ServerResponse,
  message?: string,
  sso?: SsoLink | null,
  returnTo?: string,
): void {
  sendPage(
    response,
    401,
    'Sign in',
    `${ssoBlock(sso, returnTo)}<p>${escape(message ?? 'Open the login link an administrator gave you.')}</p><p>An administrator makes a link with <code>aip server login-link --email &lt;email&gt;</code> on the server.</p>`,
  );
}

export function errorPage(response: ServerResponse, status: number, message: string): void {
  sendPage(response, status, 'Cannot sign in', `<p>${escape(message)}</p>`);
}

export function confirmCliPage(
  response: ServerResponse,
  fields: { port: string; state: string; challenge: string; machine: string },
  email: string,
): void {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`)
    .join('');
  sendPage(
    response,
    200,
    'Sign in from the command line',
    `<p>Give <b>${escape(fields.machine)}</b> access as ${escape(email)}?</p><form method="post" action="/auth/cli">${inputs}<button type="submit">Allow</button></form>`,
  );
}
