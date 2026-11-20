import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from '../../src/presentation/ipc/client/index.ts';
import { remoteRequest, remoteSubscribe } from '../../src/presentation/ipc/client/remote.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';

import { liveStatus, openLive } from '../fixtures/live.ts';
import { harness, type Harness } from './harness.ts';

const PUBLIC = 'https://aip.example.com';
const HOST = 'aip.example.com';

let current: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  vi.useRealTimers();
  await web?.close();
  web = null;
  await current?.close();
  current = null;
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function start(
  trustedProxies: string[] = [],
  live?: { recheckMs: number },
): Promise<Harness> {
  current = await harness();
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server: { enabled: true, public_url: "${PUBLIC}", default_role: developer }\n`,
  );
  web = await startWebServer({
    socket: current.socket,
    host: '127.0.0.1',
    port: 0,
    server: { publicUrl: PUBLIC, trustedProxies },
    ...(live ? { live } : {}),
  });
  return current;
}

function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port: web?.port, path, method, headers: { host: HOST, ...headers } },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const json = { 'content-type': 'application/json' };

async function link(h: Harness, email: string, admin = false): Promise<string> {
  const made = (await request(h.socket, 'login_link_create', { email, admin })) as { url: string };
  return made.url.slice(PUBLIC.length);
}

async function signIn(h: Harness, email: string, admin = false): Promise<string> {
  const answer = await send('GET', await link(h, email, admin));
  expect(answer.status).toBe(302);
  const cookie = String((answer.headers['set-cookie'] as string[])[0]);
  return cookie.split(';')[0] as string;
}

async function ipc(cookieOrToken: string, method: string, params: unknown = {}, extra = {}) {
  const auth: Record<string, string> = cookieOrToken.startsWith('aip_pat_')
    ? { authorization: `Bearer ${cookieOrToken}` }
    : { cookie: cookieOrToken, origin: PUBLIC };
  return send(
    'POST',
    '/api/ipc',
    { ...json, ...auth },
    JSON.stringify({ method, params, ...extra }),
  );
}

describe('panel in server mode', () => {
  it('redirects a page without a session to the login page and answers the API with 401', async () => {
    await start();
    const page = await send('GET', '/');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/auth/login');
    expect((await send('GET', '/api/runs')).status).toBe(401);
  });

  it('ignores the shared token and its cookie', async () => {
    await start();
    const header = await send('GET', '/api/runs', { 'x-aip-token': 'abcdefghijklmnop1234' });
    expect(header.status).toBe(401);
    const cookie = await send('GET', '/api/runs', { cookie: 'aip_token=abcdefghijklmnop1234' });
    expect(cookie.status).toBe(401);
    expect((await send('GET', '/?token=abcdefghijklmnop1234')).status).toBe(302);
  });

  it('takes only the host of public_url', async () => {
    await start(['10.0.0.5']);
    expect((await send('GET', '/', { host: '10.0.0.1:7341' })).status).toBe(403);
    // the peer is 127.0.0.1, not a trusted proxy: the forwarded host does not count
    const forged = await send('GET', '/', { host: '10.0.0.1:7341', 'x-forwarded-host': HOST });
    expect(forged.status).toBe(403);
  });

  it('trusts the forwarded host of a trusted proxy', async () => {
    await start(['127.0.0.1']);
    const forwarded = await send('GET', '/', {
      host: '10.0.0.1:7341',
      'x-forwarded-host': HOST,
      'x-forwarded-proto': 'https',
    });
    expect(forwarded.status).toBe(302);
  });

  it('signs in by a link once and sets a safe cookie', async () => {
    const h = await start();
    const path = await link(h, 'admin@example.com', true);
    const answer = await send('GET', path);
    expect(answer.status).toBe(302);
    const cookie = (answer.headers['set-cookie'] as string[])[0] as string;
    expect(cookie).toMatch(/^aip_session=[A-Za-z0-9_-]{32,};/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure']) {
      expect(cookie).toContain(flag);
    }
    const again = await send('GET', path);
    expect(again.status).toBe(400);
    expect(again.body).toMatch(/already used/);
    const page = await send('GET', '/', { cookie: cookie.split(';')[0] as string });
    expect(page.status).toBe(200);
  });

  it('refuses a state change from another origin', async () => {
    const h = await start();
    const cookie = await signIn(h, 'admin@example.com', true);
    const evil = await send('POST', '/api/runs/r1/cancel', {
      cookie,
      origin: 'https://evil.example',
    });
    expect(evil.status).toBe(403);
    const none = await send('POST', '/api/runs/r1/cancel', { cookie });
    expect(none.status).toBe(403);
  });

  it('ends the session at logout', async () => {
    const h = await start();
    const cookie = await signIn(h, 'admin@example.com', true);
    expect((await send('GET', '/api/runs', { cookie })).status).toBe(200);
    const out = await send('POST', '/auth/logout', { cookie, origin: PUBLIC });
    expect(out.status).toBe(200);
    expect(String((out.headers['set-cookie'] as string[])[0])).toContain('Max-Age=0');
    expect((await send('GET', '/api/runs', { cookie })).status).toBe(401);
  });

  it('closes the list of directories for a user who is not an administrator', async () => {
    const h = await start();
    await signIn(h, 'admin@example.com', true);
    const bob = await signIn(h, 'bob@example.com');
    const answer = await send('GET', '/api/directories', { cookie: bob });
    expect(answer.status).toBe(403);
  });
});

describe('remote transport', () => {
  async function token(h: Harness, email: string, admin = false): Promise<string> {
    const cookie = await signIn(h, email, admin);
    const made = await ipc(cookie, 'tokens_create', { name: 'laptop', ttl: '30d' });
    return (JSON.parse(made.body) as { value: string }).value;
  }

  it('answers status with a token and no Origin', async () => {
    const h = await start();
    const value = await token(h, 'admin@example.com', true);
    const answer = await ipc(value, 'status');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual(await h.call('status', {}));
  });

  it('answers an unknown method with 400 and the closed methods with 403', async () => {
    const h = await start();
    const value = await token(h, 'admin@example.com', true);
    expect((await ipc(value, 'nope')).status).toBe(400);
    for (const method of [
      'shutdown',
      'shutdown_idle',
      'web_stop',
      'process_kill',
      'report',
      'mcp_remote_forward',
    ]) {
      expect((await ipc(value, method)).status, method).toBe(403);
    }
    await expect(h.call('status', {})).resolves.toBeDefined();
  });

  it('works for the person of the token whatever actor the body names', async () => {
    const h = await start();
    await signIn(h, 'admin@example.com', true);
    const bob = await token(h, 'bob@example.com');
    const answer = await ipc(bob, 'tokens_list', {}, { actor: 'someone-else' });
    const tokens = (JSON.parse(answer.body) as { tokens: { name: string }[] }).tokens;
    expect(tokens.map((item) => item.name)).toEqual(['laptop']);
    const admin = await ipc(bob, 'users_list');
    expect(admin.status).toBe(403);
    expect(JSON.parse(admin.body).code).toBe('access.denied');
  });

  it('answers a revoked token with 401', async () => {
    const h = await start();
    const value = await token(h, 'admin@example.com', true);
    await request(
      h.socket,
      'tokens_revoke',
      { token: 'laptop' },
      30_000,
      (await userId(h)) as string,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    expect((await ipc(value, 'status')).status).toBe(401);
  });

  it('stops a disabled user within the cache time', async () => {
    const h = await start();
    await signIn(h, 'admin@example.com', true);
    const bob = await token(h, 'bob@example.com');
    expect((await ipc(bob, 'status')).status).toBe(200);
    await request(h.socket, 'users_disable', { email: 'bob@example.com' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    expect((await ipc(bob, 'status')).status).toBe(401);
  });

  it('opens the live connection for a signed-in user and closes it once the access is gone', async () => {
    const h = await start([], { recheckMs: 30 });
    await signIn(h, 'admin@example.com', true);
    const bob = await token(h, 'bob@example.com');
    const base = `http://127.0.0.1:${web?.port}`;
    expect(await liveStatus(base, { host: HOST })).toBe(401);
    expect(await liveStatus(base, { host: HOST, authorization: 'Bearer aip_pat_nope' })).toBe(401);
    const allowed = { host: HOST, authorization: `Bearer ${bob}` };
    expect(await liveStatus(base, { ...allowed, origin: 'https://evil.example' })).toBe(403);
    expect(await liveStatus(base, { authorization: `Bearer ${bob}` })).toBe(403);
    const probe = await openLive(base, allowed);
    await probe.until('"snapshot"');
    expect(probe.messages[0]).toMatchObject({ event: 'snapshot' });
    // the reads of a subscription are made for the user and answered by the daemon
    probe.send({
      op: 'subscribe',
      id: 'g1',
      topic: { kind: 'group', runId: 'nope', group: 'login' },
    });
    expect(await probe.message('the answer', (message) => message.id === 'g1')).toMatchObject({
      event: 'topic_error',
    });
    await request(h.socket, 'users_disable', { email: 'bob@example.com' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    expect(await probe.closed).toBe(4401);
    expect(await liveStatus(base, allowed)).toBe(401);
  });

  it('is used by the remote client for requests and events', async () => {
    current = await harness();
    const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    writeFileSync(
      join(directory, 'settings.yaml'),
      `server: { enabled: true, public_url: "${url}", default_role: developer }\n`,
    );
    web = await startWebServer({
      socket: current.socket,
      host: '127.0.0.1',
      port,
      server: { publicUrl: url, trustedProxies: [] },
    });
    const made = (await request(current.socket, 'login_link_create', {
      email: 'admin@example.com',
      admin: true,
    })) as { url: string };
    const code = made.url.split('/auth/link/')[1] as string;
    const signed = (await request(current.socket, 'auth_link_login', { code })) as {
      user: { id: string };
    };
    const created = (await request(
      current.socket,
      'tokens_create',
      { name: 'cli' },
      30_000,
      signed.user.id,
    )) as { value: string };
    const remote = { url, token: created.value };
    expect(await remoteRequest(remote, 'status', {})).toEqual(await current.call('status', {}));
    await expect(remoteRequest(remote, 'shutdown', {})).rejects.toMatchObject({
      remoteKind: 'forbidden',
    });
    await expect(remoteRequest({ url, token: 'aip_pat_nope' }, 'status', {})).rejects.toMatchObject(
      {
        remoteKind: 'unauthorized',
      },
    );
    const controller = new AbortController();
    const first = new Promise<string>((resolve) => {
      void remoteSubscribe(remote, resolve, controller.signal);
    });
    expect(JSON.parse(await first)).toMatchObject({ event: 'snapshot' });
    controller.abort();
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function userId(h: Harness): Promise<string> {
  const users = (await request(h.socket, 'users_list', {})) as { users: { id: string }[] };
  return (users.users[0] as { id: string }).id;
}

describe('login of the CLI', () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = (state: string) =>
    `/auth/cli?port=45678&state=${state}&challenge=${challenge}&machine=laptop`;

  it('exchanges a confirmed code for a token once', async () => {
    const h = await start();
    const cookie = await signIn(h, 'admin@example.com', true);
    const page = await send('GET', query('state-12345'), { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toContain('laptop');
    const form = new URLSearchParams({
      port: '45678',
      state: 'state-12345',
      challenge,
      machine: 'laptop',
    }).toString();
    const approved = await send(
      'POST',
      '/auth/cli',
      { cookie, origin: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
      form,
    );
    expect(approved.status).toBe(302);
    const target = new URL(String(approved.headers.location));
    expect(target.origin).toBe('http://127.0.0.1:45678');
    expect(target.searchParams.get('state')).toBe('state-12345');
    const code = target.searchParams.get('code') as string;
    const exchange = (body: object) => send('POST', '/auth/cli/token', json, JSON.stringify(body));
    const wrong = await exchange({ code, verifier: 'x'.repeat(43) });
    expect(wrong.status).toBe(401);
    const used = await exchange({ code, verifier });
    expect(used.status).toBe(401);
    const second = await send(
      'POST',
      '/auth/cli',
      { cookie, origin: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
      form,
    );
    const code2 = new URL(String(second.headers.location)).searchParams.get('code') as string;
    const ok = await exchange({ code: code2, verifier });
    expect(ok.status).toBe(200);
    expect((JSON.parse(ok.body) as { token: string }).token).toMatch(/^aip_pat_/);
    expect((await exchange({ code: code2, verifier })).status).toBe(401);
  });

  it('asks for a session before the confirmation', async () => {
    await start();
    expect((await send('GET', query('state-12345'))).status).toBe(401);
  });
});
