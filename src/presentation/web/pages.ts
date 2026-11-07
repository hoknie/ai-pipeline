import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

import { panel, TOKEN_HINT } from './errors.ts';
import { COOKIE, cookieToken, sameToken, send } from './http.ts';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MISSING_BUILD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>aip</title></head><body><h1>aip web</h1><p>The panel is not built. Run <code>npm run build</code> in the aip repository and reload this page.</p></body></html>`;

/** The page: needs the token in the query or the cookie, and sets the cookie. */
export function servePage(
  response: ServerResponse,
  assets: string,
  token: string | null,
  fromQuery: string | undefined,
  cookie: string | undefined,
): void {
  if (token !== null && !sameToken(fromQuery, token) && !sameToken(cookieToken(cookie), token))
    throw panel('unauthorized', TOKEN_HINT);
  const index = join(assets, 'index.html');
  const page = existsSync(index) ? readFileSync(index, 'utf8') : MISSING_BUILD;
  send(response, 200, page, 'text/html', {
    ...(token === null
      ? {}
      : { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` }),
    'content-security-policy': PAGE_POLICY,
    'cache-control': 'no-cache',
  });
}

/** A file under `assets/`; never one outside the built panel. */
export function serveAsset(response: ServerResponse, assets: string, pathname: string): void {
  const file = normalize(join(assets, decodeURIComponent(pathname)));
  if (!file.startsWith(assets.endsWith(sep) ? assets : `${assets}${sep}`) || !existsSync(file))
    throw panel('not_found', 'not found');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
    // Vite names assets by their content hash, so they never change.
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  response.end(readFileSync(file));
}
