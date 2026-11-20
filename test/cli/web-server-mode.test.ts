import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { request } from '../../src/presentation/ipc/client/index.ts';
import { remoteRequest } from '../../src/presentation/ipc/client/remote.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { harness, settle, startRun, type Harness } from '../daemon/harness.ts';
import { openLive } from '../fixtures/live.ts';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeOidcProvider } from '../fakes/oidc-provider.ts';

let current: Harness | null = null;
let web: WebServer | null = null;
let provider: FakeOidcProvider | null = null;
let base = '';
const logs: string[] = [];

afterEach(async () => {
  await web?.close();
  web = null;
  await current?.close();
  current = null;
  await provider?.stop();
  provider = null;
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function start(extra = ''): Promise<Harness> {
  provider = await new FakeOidcProvider().start();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  logs.length = 0;
  current = await harness(
    undefined,
    { AIP_OIDC_SECRET: FAKE_CLIENT_SECRET },
    {
      log: (message) => logs.push(message),
    },
  );
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server:
  enabled: true
  public_url: "${base}"
  default_role: developer
  sso:
    oidc:
      issuer: "${provider.issuer}"
      client_id: ${FAKE_CLIENT_ID}
      client_secret_env: AIP_OIDC_SECRET
      label: Keycloak
      attributes: { groups: groups }
${extra}`,
  );
  web = await startWebServer({
    socket: current.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: base, trustedProxies: [] },
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
      { host: '127.0.0.1', port: web?.port, path, method, headers },
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

const location = (answer: Answer): string => String(answer.headers.location);

function cookieOf(answer: Answer): string | null {
  const header = answer.headers['set-cookie'] as string[] | undefined;
  return header?.[0]?.split(';')[0] ?? null;
}

/** The browser: the panel sends it to the provider, the user signs in there, it comes back. */
async function browse(
  claims: Record<string, unknown>,
  options: { returnTo?: string } = {},
): Promise<Answer> {
  const query = options.returnTo ? `?returnTo=${encodeURIComponent(options.returnTo)}` : '';
  const started = await send('GET', `/auth/oidc/start${query}`);
  expect(started.status).toBe(302);
  const back = new URL(provider!.authorize(location(started), claims));
  return send('GET', back.pathname + back.search);
}

const ALICE = { sub: '42', email: 'alice@corp.com', email_verified: true, name: 'Alice' };

async function whoami(cookie: string) {
  const answer = await send(
    'POST',
    '/api/ipc',
    { cookie, origin: base, 'content-type': 'application/json' },
    JSON.stringify({ method: 'whoami', params: {} }),
  );
  return JSON.parse(answer.body) as { user: { email: string; source: string } | null };
}

describe('sign-in through OIDC in the panel', () => {
  it('shows the button on the login page and signs the user in', async () => {
    await start();
    const page = await send('GET', '/auth/login');
    expect(page.body).toContain('Sign in with Keycloak');
    expect(page.body).toContain('/auth/oidc/start');
    const done = await browse({ ...ALICE, groups: ['dev'] }, { returnTo: '/runs' });
    expect(done.status).toBe(302);
    expect(location(done)).toBe('/runs');
    const cookie = cookieOf(done);
    expect(cookie).toMatch(/^aip_session=/);
    expect((await whoami(cookie!)).user).toMatchObject({ email: 'alice@corp.com', source: 'oidc' });
    const users = (await request(current!.socket, 'users_list', {})) as {
      users: { attributes: unknown }[];
    };
    expect(users.users[0]?.attributes).toEqual({ groups: ['dev'] });
  });

  it('refuses a forged state and creates no session', async () => {
    await start();
    const forged = await send('GET', '/auth/oidc/callback?code=abc&state=forged');
    expect(forged.status).toBe(400);
    expect(forged.body).toContain('Cannot sign in');
    expect(cookieOf(forged)).toBeNull();
    const started = await send('GET', '/auth/oidc/start');
    const back = new URL(provider!.authorize(location(started), ALICE));
    back.searchParams.set('state', 'forged');
    const answer = await send('GET', back.pathname + back.search);
    expect(answer.status).toBe(400);
    expect(cookieOf(answer)).toBeNull();
    const users = (await request(current!.socket, 'users_list', {})) as { users: unknown[] };
    expect(users.users).toEqual([]);
  });

  it('refuses a domain outside allowed_domains', async () => {
    await start('      allowed_domains: [corp.com]\n');
    const answer = await browse({ sub: '7', email: 'eve@gmail.com', email_verified: true });
    expect(answer.status).toBe(403);
    expect(answer.body).toContain('corp.com');
    expect(cookieOf(answer)).toBeNull();
    const users = (await request(current!.socket, 'users_list', {})) as { users: unknown[] };
    expect(users.users).toEqual([]);
  });

  it('reports an unavailable provider while links keep working', async () => {
    await start();
    provider!.down = true;
    const answer = await send('GET', '/auth/oidc/start');
    expect(answer.status).toBe(503);
    expect(answer.body).toContain('not available');
    const page = await send('GET', '/auth/login');
    expect(page.body).toContain('SSO provider is not available');
    expect(page.body).toContain('/auth/oidc/start');
    expect(logs.some((line) => line.includes(provider!.issuer))).toBe(true);
    const made = (await request(current!.socket, 'login_link_create', {
      email: 'admin@corp.com',
      admin: true,
    })) as { url: string };
    const linked = await send('GET', made.url.slice(base.length));
    expect(linked.status).toBe(302);
    provider!.down = false;
    expect((await browse(ALICE)).status).toBe(302);
  });

  it('returns to the aip login page after the sign-in', async () => {
    await start();
    const target = '/auth/cli?port=4000&state=s1&challenge=c1&machine=laptop';
    const page = await send('GET', target);
    expect(page.status).toBe(401);
    expect(page.body).toContain(`/auth/oidc/start?returnTo=${encodeURIComponent(target)}`);
    const done = await browse(ALICE, { returnTo: target });
    expect(done.status).toBe(302);
    expect(location(done)).toBe(target);
  });

  it('goes from the provider to aip login, a token and a request as the oidc user', async () => {
    await start();
    const cookie = cookieOf(await browse(ALICE))!;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const fields = { port: '45678', state: 'state-12345', challenge, machine: 'laptop' };
    const page = await send('GET', `/auth/cli?${new URLSearchParams(fields)}`, { cookie });
    expect(page.status).toBe(200);
    const approved = await send(
      'POST',
      '/auth/cli',
      { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
      new URLSearchParams(fields).toString(),
    );
    const code = new URL(location(approved)).searchParams.get('code')!;
    const exchanged = await send(
      'POST',
      '/auth/cli/token',
      { 'content-type': 'application/json' },
      JSON.stringify({ code, verifier }),
    );
    const { token } = JSON.parse(exchanged.body) as { token: string };
    const me = (await remoteRequest({ url: base, token }, 'whoami', {})) as {
      user: { email: string; source: string };
    };
    expect(me.user).toMatchObject({ email: 'alice@corp.com', source: 'oidc' });
  });
});

describe('the author in the panel API', () => {
  it('shows the author of a run to a user who signed in through the provider', async () => {
    const h = await start();
    const cookie = cookieOf(await browse(ALICE))!;
    const users = (await request(h.socket, 'users_list', {})) as {
      users: { id: string; email: string }[];
    };
    const alice = users.users.find((user) => user.email === 'alice@corp.com')!;
    h.script({ code: [{}, {}] });
    const created = (await request(
      h.socket,
      'run',
      { repository: h.repo, pipeline: 'feature', task: 'work' },
      30_000,
      alice.id,
    )) as { run: { runId: string } | null; item: string };
    const runId = created.run?.runId;
    expect(runId).toBeDefined();
    const answer = await send('GET', `/api/runs/${runId}`, { cookie });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({
      id: runId,
      author: { id: alice.id, email: 'alice@corp.com', name: 'Alice', disabled: false },
    });
  });
});

describe('the audit journal of the sign-ins of the panel', () => {
  it('records a sign-in refused for its domain with the reason and the address of the client', async () => {
    const h = await start('      allowed_domains: [corp.com]\n');
    await browse({ sub: '7', email: 'eve@gmail.com', email_verified: true });
    await browse(ALICE);
    const { events } = (await request(h.socket, 'audit_list', {})) as {
      events: { action: string; outcome: string; details: Record<string, unknown> }[];
    };
    const failed = events.find((event) => event.action === 'auth.login_failed');
    expect(failed).toMatchObject({ outcome: 'failed', details: { method: 'oidc' } });
    expect(String(failed?.details.reason)).toContain('corp.com');
    expect(failed?.details.address).toBe('127.0.0.1');
    const login = events.find((event) => event.action === 'auth.login');
    expect(login?.details).toMatchObject({ method: 'oidc', email: 'alice@corp.com' });
  });
});

describe('access in the panel', () => {
  const BOB = { sub: '43', email: 'bob@corp.com', email_verified: true, name: 'Bob' };

  it('keeps the events and the answers of a project from a user who cannot read it', async () => {
    await start();
    const directory = join(String(current!.environment.XDG_CONFIG_HOME), 'aip');
    writeFileSync(
      join(directory, 'access.yaml'),
      `rules:
  - id: outsiders-see-nothing
    effect: deny
    actions: ['*']
    subject: { groups: [outsiders] }
`,
    );
    await current!.call('repository_add', { path: current!.repo });
    const alice = cookieOf(await browse({ ...ALICE, groups: ['dev'] }))!;
    const bob = cookieOf(await browse({ ...BOB, groups: ['outsiders'] }))!;
    const aliceLive = await openLive(base, { cookie: alice, origin: base });
    const bobLive = await openLive(base, { cookie: bob, origin: base });
    current!.script({ code: [{ waitFor: current!.gate('hold') }] });
    const run = await startRun(current!, {
      repository: current!.repo,
      pipeline: 'feature',
      task: 'work',
    });
    try {
      await aliceLive.message('the run', (m) => m.event === 'run');
      await settle(current!);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(aliceLive.text).toContain(run.runId);
      expect(bobLive.text).not.toContain(run.runId);
      expect(bobLive.text).not.toContain(current!.repo);
      const snapshot = bobLive.messages.find((m) => m.event === 'snapshot');
      expect(snapshot).toMatchObject({ runs: [], queues: [], repositories: [] });
      const headers = { origin: base };
      const own = await send('GET', `/api/runs/${run.runId}`, { cookie: alice, ...headers });
      expect(own.status).toBe(200);
      const hidden = await send('GET', `/api/runs/${run.runId}`, { cookie: bob, ...headers });
      expect(hidden.status).toBe(404);
      const me = await send('GET', '/api/access/me', { cookie: bob, ...headers });
      expect(JSON.parse(me.body)).toMatchObject({ actions: [], repositories: [] });
      const mine = await send('GET', '/api/access/me', { cookie: alice, ...headers });
      expect(JSON.parse(mine.body).actions).toContain('run.cancel');
    } finally {
      aliceLive.close();
      bobLive.close();
      current!.open('hold');
    }
  });

  it('lists directories for whoever the policies let add a project', async () => {
    await start();
    const directory = join(String(current!.environment.XDG_CONFIG_HOME), 'aip');
    writeFileSync(
      join(directory, 'access.yaml'),
      `rules:
  - id: ops-add-projects
    effect: allow
    actions: [project.add]
    subject: { groups: [ops] }
`,
    );
    const ops = cookieOf(await browse({ ...ALICE, groups: ['ops'] }))!;
    const dev = cookieOf(await browse({ ...BOB, groups: ['dev'] }))!;
    const headers = { origin: base };
    const allowed = await send('GET', '/api/directories', { cookie: ops, ...headers });
    expect(allowed.status).toBe(200);
    const refused = await send('GET', '/api/directories', { cookie: dev, ...headers });
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).code).toBe('access.denied');
  });
});
