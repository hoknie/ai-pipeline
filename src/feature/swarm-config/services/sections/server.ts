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
import { checkSaml } from './server-saml.ts';
import { type FieldError } from '../../types/errors.ts';
import {
  DEFAULT_OIDC_SCOPES,
  defaultServer,
  type OidcSettings,
  type ServerSettings,
  type WebSettings,
} from '../../types/settings.ts';

const SERVER_KEYS = [
  'enabled',
  'listen',
  'public_url',
  'trusted_proxies',
  'session_ttl',
  'token_max_ttl',
  'sso',
];

const SSO_KEYS = ['oidc', 'saml'];

const OIDC_KEYS = [
  'issuer',
  'client_id',
  'client_secret_env',
  'scopes',
  'label',
  'claims',
  'attributes',
  'allowed_domains',
];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function issuerProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be a URL such as `https://sso.example.com/realms/aip`';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must use http or https';
  if (url.search !== '' || url.hash !== '') return 'must have no query or fragment';
  return null;
}

function checkClaims(ctx: ValidateContext, value: unknown, path: string, oidc: OidcSettings): void {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, path, ['email', 'name'])) {
    const text = readString(ctx, field, join(path, key));
    if (text !== null) oidc.claims[key as 'email' | 'name'] = text;
  }
}

function checkAttributes(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  oidc: OidcSettings,
): void {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, path, null)) {
    const text = readString(ctx, field, join(path, key));
    if (text !== null) oidc.attributes[key] = text;
  }
}

function checkOidcField(
  ctx: ValidateContext,
  oidc: OidcSettings,
  key: string,
  field: unknown,
  path: string,
): void {
  if (key === 'issuer') {
    const value = readString(ctx, field, path);
    const problem = value === null ? null : issuerProblem(value);
    if (problem) addError(ctx, path, problem);
    else if (value !== null) oidc.issuer = value;
  }
  if (key === 'client_id') oidc.clientId = readString(ctx, field, path) ?? oidc.clientId;
  if (key === 'client_secret_env') {
    const value = readString(ctx, field, path);
    if (value !== null && !ENV_NAME.test(value)) {
      addError(ctx, path, 'must be the name of an environment variable');
    } else if (value !== null) oidc.clientSecretEnv = value;
  }
  if (key === 'scopes') {
    const items = readStrings(ctx, field, path);
    if (items.length > 0) oidc.scopes = items;
  }
  if (key === 'label') oidc.label = readString(ctx, field, path) ?? oidc.label;
  if (key === 'claims') checkClaims(ctx, field, path, oidc);
  if (key === 'attributes') checkAttributes(ctx, field, path, oidc);
  if (key === 'allowed_domains') {
    const items = readStrings(ctx, field, path);
    items.forEach((item, index) => {
      if (!DOMAIN.test(item))
        addError(ctx, `${path}[${index}]`, 'must be a domain such as corp.com');
    });
    oidc.allowedDomains = items.filter((item) => DOMAIN.test(item)).map((d) => d.toLowerCase());
  }
}

function checkOidc(ctx: ValidateContext, value: unknown, path: string): OidcSettings | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const oidc: OidcSettings = {
    issuer: '',
    clientId: '',
    clientSecretEnv: '',
    scopes: [...DEFAULT_OIDC_SCOPES],
    label: 'SSO',
    claims: { email: 'email', name: 'name' },
    attributes: {},
    allowedDomains: [],
  };
  if ('client_secret' in mapping) {
    addError(
      ctx,
      join(path, 'client_secret'),
      'the client secret must not be stored in settings.yaml; set `client_secret_env` to the name of an environment variable of the daemon',
    );
  }
  const keys = [...OIDC_KEYS, 'client_secret'];
  const before = ctx.errors.length;
  for (const [key, field] of readEntries(ctx, mapping, path, keys)) {
    if (key !== 'client_secret') checkOidcField(ctx, oidc, key, field, join(path, key));
  }
  for (const required of ['issuer', 'client_id', 'client_secret_env']) {
    if (!(required in mapping)) addError(ctx, join(path, required), 'is required');
  }
  return ctx.errors.length === before ? oidc : null;
}

function checkSso(ctx: ValidateContext, value: unknown, server: ServerSettings): void {
  const path = 'swarm.server.sso';
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, path, SSO_KEYS)) {
    if (key === 'oidc') server.sso.oidc = checkOidc(ctx, field, join(path, key));
    if (key === 'saml') server.sso.saml = checkSaml(ctx, field, join(path, key));
  }
}

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
  if (key === 'sso') checkSso(ctx, field, server);
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
