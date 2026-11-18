import { isIP } from 'node:net';
import {
  type ValidateContext,
  addError,
  join,
  readBoolean,
  readEntries,
  readMapping,
  readString,
  readStrings,
} from '../validate-context.ts';
import { type FieldError } from '../../types/errors.ts';
import { defaultServer, type ServerSettings, type WebSettings } from '../../types/settings.ts';

const SERVER_KEYS = [
  'enabled',
  'listen',
  'public_url',
  'trusted_proxies',
  'session_ttl',
  'token_max_ttl',
];

const SESSION_TTL = /^[1-9]\d*[hd]$/;

const TOKEN_TTL = /^[1-9]\d*d$/;

function listenProblem(value: string): string | null {
  const match = /^(.+):(\d{1,5})$/.exec(value);
  const port = match ? Number(match[2]) : 0;
  if (!match || port < 1 || port > 65535) return 'must be `<address>:<port>`';
  return null;
}

function publicUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be a URL such as `https://aip.example.com`';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must use http or https';
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return 'must have no path';
  return null;
}

function checkField(
  ctx: ValidateContext,
  server: ServerSettings,
  key: string,
  field: unknown,
  path: string,
): void {
  if (key === 'enabled') server.enabled = readBoolean(ctx, field, path) ?? server.enabled;
  if (key === 'listen') {
    const value = readString(ctx, field, path);
    const problem = value === null ? null : listenProblem(value);
    if (problem) addError(ctx, path, problem);
    else if (value !== null) server.listen = value;
  }
  if (key === 'public_url') {
    const value = readString(ctx, field, path);
    const problem = value === null ? null : publicUrlProblem(value);
    if (problem) addError(ctx, path, problem);
    else if (value !== null) server.publicUrl = value.replace(/\/$/, '');
  }
  if (key === 'trusted_proxies') {
    const items = readStrings(ctx, field, path);
    items.forEach((item, index) => {
      if (isIP(item) === 0) addError(ctx, `${path}[${index}]`, 'must be an IP address');
    });
    server.trustedProxies = items.filter((item) => isIP(item) !== 0);
  }
  if (key === 'session_ttl') {
    const value = readString(ctx, field, path);
    if (value !== null && !SESSION_TTL.test(value)) addError(ctx, path, 'must be `<n>h` or `<n>d`');
    else if (value !== null) server.sessionTtl = value;
  }
  if (key === 'token_max_ttl') {
    const value = readString(ctx, field, path);
    if (value !== null && !TOKEN_TTL.test(value)) addError(ctx, path, 'must be `<n>d`');
    else if (value !== null) server.tokenMaxTtl = value;
  }
}

/** Checks `swarm.server`; fills `server` with the valid fields. */
export function checkServer(ctx: ValidateContext, value: unknown, server: ServerSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.server');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.server', SERVER_KEYS)) {
    checkField(ctx, server, key, field, join('swarm.server', key));
  }
  if (!server.enabled) return;
  if (server.publicUrl === null && !('public_url' in mapping)) {
    addError(ctx, 'swarm.server.public_url', 'is required when server.enabled is true');
  }
}

/** Server mode needs the panel and a login: the shared token and `autostart: false` conflict. */
export function checkServerWeb(
  ctx: ValidateContext,
  server: ServerSettings,
  web: WebSettings,
): void {
  if (!server.enabled) return;
  if (web.auth === 'none') {
    addError(ctx, 'swarm.web.auth', 'must not be `none` when server.enabled is true');
  }
  if (!web.autostart) {
    addError(ctx, 'swarm.web.autostart', 'must not be false when server.enabled is true');
  }
}

/** Checks the `server` section alone together with `web`; `value` is the content of `swarm.server`. */
export function validateServerSection(
  value: unknown,
  web: WebSettings,
): { server: ServerSettings; errors: FieldError[] } {
  const ctx: ValidateContext = { errors: [] };
  const server = defaultServer();
  if (value !== undefined) checkServer(ctx, value, server);
  checkServerWeb(ctx, server, web);
  return { server, errors: ctx.errors };
}
