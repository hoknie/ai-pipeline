import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { request } from '../../src/presentation/ipc/client/index.ts';
import type { AuditEventView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';

import { aip, ownDaemon, sandbox, type Sandbox } from './sandbox.ts';

let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  web = null;
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

interface Server {
  box: Sandbox;
  url: string;
  /** The environment of a user of the CLI: the server and a personal token. */
  as(email: string, admin?: boolean): Promise<Sandbox>;
  /** The session cookie of a user of the panel. */
  cookie(email: string, admin: boolean): Promise<string>;
  /** A call of the panel with the session of a user. */
  panel(email: string, method: string, params: object): Promise<Response>;
}

async function serverMode(): Promise<Server> {
  const box = sandbox();
  await ownDaemon(box);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const directory = join(String(box.env.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server: { enabled: true, public_url: "${url}" }\n`,
  );
  web = await startWebServer({
    socket: box.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: url, trustedProxies: [] },
  });
  const cookies = new Map<string, string>();
  const cookie = async (email: string, admin: boolean): Promise<string> => {
    const known = cookies.get(email);
    if (known) return known;
    const made = (await request(box.socket, 'login_link_create', { email, admin })) as {
      url: string;
    };
    const answer = await fetch(made.url, { redirect: 'manual' });
    const value = (answer.headers.get('set-cookie') as string).split(';')[0] as string;
    cookies.set(email, value);
    return value;
  };
  const panel = async (email: string, method: string, params: object) =>
    fetch(`${url}/api/ipc`, {
      method: 'POST',
      headers: {
        cookie: await cookie(email, email.startsWith('admin')),
        origin: url,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method, params }),
    });
  const as = async (email: string, admin = email.startsWith('admin')): Promise<Sandbox> => {
    await cookie(email, admin);
    const made = await panel(email, 'tokens_create', { name: 'cli' });
    const { value } = (await made.json()) as { value: string };
    return { ...box, env: { ...box.env, AIP_SERVER: url, AIP_TOKEN: value } };
  };
  return { box, url, as, panel, cookie };
}

describe('aip audit', () => {
  it('shows an administrator what the users did, filtered, newest first', async () => {
    const server = await serverMode();
    const admin = await server.as('admin@corp.com');
    await server.panel('alice@corp.com', 'queue_add', {
      repository: server.box.repo,
      pipeline: 'feature',
      task: 'work',
      title: 'Alice task',
    });
    await server.panel('bob@corp.com', 'queue_add', {
      repository: server.box.repo,
      pipeline: 'feature',
      task: 'work',
      title: 'Bob task',
    });
    const mine = await aip(
      admin,
      'audit',
      '--user',
      'alice@corp.com',
      '--action',
      'queue.',
      '--since',
      '1d',
      '--json',
    );
    expect(mine.code).toBe(0);
    const events = JSON.parse(mine.stdout) as AuditEventView[];
    expect(events.map((event) => [event.user?.email, event.action, event.outcome])).toEqual([
      ['alice@corp.com', 'queue.add', 'ok'],
    ]);

    const everything = await aip(admin, 'audit', '--action', 'queue.', '--repo', 'repo');
    expect(everything.stderr).toBe('');
    expect(everything.code).toBe(0);
    const lines = everything.stdout.split('\n');
    expect(lines[0]).toContain('WHO');
    expect(lines.findIndex((line) => line.includes('bob@corp.com'))).toBeLessThan(
      lines.findIndex((line) => line.includes('alice@corp.com')),
    );

    const limited = await aip(admin, 'audit', '--action', 'queue.', '--limit', '1', '--json');
    expect(JSON.parse(limited.stdout)).toHaveLength(1);
    const bad = await aip(admin, 'audit', '--since', 'soon');
    expect(bad.code).not.toBe(0);
  });

  it('refuses a user who is not an administrator, with a message and a non-zero code', async () => {
    const server = await serverMode();
    const bob = await server.as('bob@corp.com', false);
    const result = await aip(bob, 'audit');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/administrator|access|denied/i);
  });

  it('answers GET /api/audit to an administrator and with 403 to the others', async () => {
    const server = await serverMode();
    await server.panel('bob@corp.com', 'queue_add', {
      repository: server.box.repo,
      pipeline: 'feature',
      task: 'work',
    });
    const admin = await server.cookie('admin2@corp.com', true);
    const dev = await server.cookie('carol@corp.com', false);
    const ok = await fetch(`${server.url}/api/audit?action=queue.&since=1d&limit=5`, {
      headers: { cookie: admin },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { events: AuditEventView[] };
    expect(body.events.map((event) => event.action)).toContain('queue.add');
    const refused = await fetch(`${server.url}/api/audit`, { headers: { cookie: dev } });
    expect(refused.status).toBe(403);
    const invalid = await fetch(`${server.url}/api/audit?since=soon`, {
      headers: { cookie: admin },
    });
    expect(invalid.status).toBe(400);
  });
});
