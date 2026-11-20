import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { plainStyle } from '../../src/presentation/format/index.ts';
import { createHostServer } from '../../src/presentation/mcp/host.ts';
import type { Method } from '../../src/presentation/ipc/contract/index.ts';
import { call, context, daemon } from '../../src/presentation/cli/context.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import type { CliIo } from '../../src/presentation/cli/io.ts';
import { runCli } from '../../src/presentation/cli/program.ts';
import { remoteProfilePath } from '../../src/platform/paths/index.ts';
import { readProfile } from '../../src/presentation/cli/commands/server/profile.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';

import { aip, main, ownDaemon, sandbox, type Sandbox } from './sandbox.ts';

let web: WebServer | null = null;

afterEach(async () => {
  vi.useRealTimers();
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
  cookie(email: string, admin?: boolean): Promise<string>;
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
    `server: { enabled: true, public_url: "${url}", default_role: developer }\n`,
  );
  web = await startWebServer({
    socket: box.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: url, trustedProxies: [] },
  });
  const cookie = async (email: string, admin = false): Promise<string> => {
    const made = (await request(box.socket, 'login_link_create', { email, admin })) as {
      url: string;
    };
    const answer = await fetch(made.url, { redirect: 'manual' });
    return (answer.headers.get('set-cookie') as string).split(';')[0] as string;
  };
  return { box, url, cookie };
}

/** `aip login`, with the browser played by the test; the browser step receives the link. */
async function login(
  server: Server,
  browser: (link: URL) => Promise<void>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  let code = 0;
  let started: Promise<void> = Promise.resolve();
  const io: CliIo = {
    cwd: server.box.repo,
    env: server.box.env,
    isTTY: false,
    entry: [process.execPath, main],
    pid: process.pid,
    stdout: (text) => {
      stdout += text;
      const match = /open (\S+)/.exec(text);
      if (match) started = browser(new URL(match[1] as string));
    },
    stderr: (text) => void (stderr += text),
    setExitCode: (value) => void (code = value),
    exit: () => undefined,
    onSignal: () => undefined,
  };
  await runCli([process.execPath, main, 'login', server.url, '--no-browser'], io);
  await started;
  return { code, stdout, stderr };
}

/** The confirmation of the browser: opens the page, presses "Allow", follows the redirect. */
function approving(server: Server, cookie: string) {
  return async (link: URL): Promise<void> => {
    const page = await fetch(link, { headers: { cookie } });
    expect(page.status).toBe(200);
    const form = new URLSearchParams(Object.fromEntries(link.searchParams)).toString();
    const approved = await fetch(`${server.url}/auth/cli`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        origin: server.url,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    expect(approved.status).toBe(302);
    await fetch(approved.headers.get('location') as string);
  };
}

describe('aip login and the commands of a server', () => {
  it('signs in, shows the user, works through the server and signs out', async () => {
    const server = await serverMode();
    const cookie = await server.cookie('admin@example.com', true);
    const result = await login(server, approving(server, cookie));
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('signed in as admin@example.com');
    const profile = remoteProfilePath(server.box.env);
    expect(statSync(profile).mode & 0o777).toBe(0o600);

    const whoami = await aip(server.box, 'whoami');
    expect(whoami.stdout).toContain(`server: ${server.url}`);
    expect(whoami.stdout).toContain('email: admin@example.com');
    expect(whoami.stdout).toContain('role=admin');

    const created = await aip(server.box, 'token', 'create', 'ci', '--ttl', '30d');
    expect(created.stdout.trim()).toMatch(/^aip_pat_/);
    const listed = await aip(server.box, 'token', 'list');
    expect(listed.stdout).toContain('ci');
    expect(listed.stdout).toContain('cli ');

    const users = await aip(server.box, 'server', 'users');
    expect(users.stdout).toContain('admin@example.com');
    const repos = await aip(server.box, 'repo', 'list', '--json');
    expect(repos.code).toBe(0);

    const daemon = await aip(server.box, 'daemon', 'status');
    expect(daemon.code).toBe(1);
    expect(daemon.stderr).toContain('aip logout');

    const profileToken = readProfile(server.box.env)?.token as string;
    const out = await aip(server.box, 'logout');
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('signed out');
    expect(existsSync(profile)).toBe(false);
    expect((await aip(server.box, 'whoami')).stdout.trim()).toBe('local mode');
    // the panel keeps the answer for the user for 10 seconds
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    await expect(
      request({ url: server.url, token: profileToken }, 'whoami', {}),
    ).rejects.toMatchObject({ remoteKind: 'unauthorized' });
    await expect(
      request({ url: server.url, token: created.stdout.trim() }, 'whoami', {}),
    ).resolves.toBeDefined();
  });

  it('refuses an answer with another state and writes no profile', async () => {
    const server = await serverMode();
    const result = await login(server, async (link) => {
      const bad = await fetch(
        `http://127.0.0.1:${link.searchParams.get('port')}/callback?code=x&state=other`,
      );
      expect(bad.status).toBe(400);
    });
    expect(result.code).toBe(1);
    expect(existsSync(remoteProfilePath(server.box.env))).toBe(false);
  });

  it('refuses a wrong verifier at the exchange', async () => {
    const server = await serverMode();
    const cookie = await server.cookie('admin@example.com', true);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const form = new URLSearchParams({
      port: '45678',
      state: 'state-12345',
      challenge,
      machine: 'laptop',
    }).toString();
    const approved = await fetch(`${server.url}/auth/cli`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        origin: server.url,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const code = new URL(approved.headers.get('location') as string).searchParams.get('code');
    const exchange = await fetch(`${server.url}/auth/cli/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier: 'x'.repeat(43) }),
    });
    expect(exchange.status).toBe(401);
  });

  it('prefers AIP_SERVER and AIP_TOKEN to the profile and the local socket', async () => {
    const server = await serverMode();
    const cookie = await server.cookie('admin@example.com', true);
    const made = await fetch(`${server.url}/api/ipc`, {
      method: 'POST',
      headers: { cookie, origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tokens_create', params: { name: 'env' } }),
    });
    const { value } = (await made.json()) as { value: string };
    const box: Sandbox = {
      ...server.box,
      env: { ...server.box.env, AIP_SERVER: server.url, AIP_TOKEN: value },
    };
    const whoami = await aip(box, 'whoami');
    expect(whoami.stdout).toContain('email: admin@example.com');
    const wrong: Sandbox = { ...box, env: { ...box.env, AIP_TOKEN: 'aip_pat_nope' } };
    const denied = await aip(wrong, 'whoami');
    expect(denied.code).toBe(1);
  });
});

describe('local mode', () => {
  it('refuses the commands of users with the server mode off', async () => {
    const box = sandbox();
    const users = await aip(box, 'server', 'users');
    expect(users.code).toBe(1);
    expect(users.stderr).toContain('server mode is off');
    expect((await aip(box, 'whoami')).stdout.trim()).toBe('local mode');
  });

  it('prints the link of a login and refuses --host and --port of aip web in server mode', async () => {
    const server = await serverMode();
    const link = await aip(
      server.box,
      'server',
      'login-link',
      '--email',
      'a@example.com',
      '--admin',
    );
    expect(link.stdout.trim()).toMatch(new RegExp(`^${server.url}/auth/link/.+`));
    const flags = await aip(server.box, 'web', '--port', '9000');
    expect(flags.code).toBe(1);
    expect(flags.stderr).toContain('server.listen');
  });
});

describe('remote commands', () => {
  async function asUser(server: Server): Promise<Sandbox> {
    const cookie = await server.cookie('admin@example.com', true);
    const made = await fetch(`${server.url}/api/ipc`, {
      method: 'POST',
      headers: { cookie, origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tokens_create', params: { name: 'env' } }),
    });
    const { value } = (await made.json()) as { value: string };
    return { ...server.box, env: { ...server.box.env, AIP_SERVER: server.url, AIP_TOKEN: value } };
  }

  it('finds the project of the current directory by its git remote', async () => {
    const server = await serverMode();
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], {
      cwd: server.box.repo,
    });
    await request(server.box.socket, 'repository_add', { path: server.box.repo });
    const box = await asUser(server);
    const queue = await aip(box, 'queue', 'list', '--json');
    expect(queue.code).toBe(0);
    expect((JSON.parse(queue.stdout) as { repository: string }).repository).toBe(server.box.repo);
  });

  it('adds a task to the queue of the server project from a clone with the same origin', async () => {
    const server = await serverMode();
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], {
      cwd: server.box.repo,
    });
    await request(server.box.socket, 'repository_add', { path: server.box.repo });
    const box = await asUser(server);
    const added = await aip(box, 'queue', 'add', 'feature', '--task', 'remote task', '--json');
    expect(added.stderr).toBe('');
    expect(added.code).toBe(0);
    const view = (await request(server.box.socket, 'queue', {
      repository: server.box.repo,
    })) as { items: { task: string | null }[] };
    expect(view.items.map((item) => item.task)).toEqual(['remote task']);
  });

  it('says so when no project of the server matches', async () => {
    const server = await serverMode();
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/unknown.git'], {
      cwd: server.box.repo,
    });
    const box = await asUser(server);
    const queue = await aip(box, 'queue', 'list');
    expect(queue.code).toBe(1);
    expect(queue.stderr).toContain('--repo <slug>');
  });

  it('serves the tools of aip mcp through the server', async () => {
    const server = await serverMode();
    const box = await asUser(server);
    const ctx = context(
      {
        cwd: box.repo,
        env: box.env,
        isTTY: false,
        entry: [process.execPath, main],
        pid: process.pid,
        stdout: () => undefined,
        stderr: () => undefined,
        setExitCode: () => undefined,
        exit: () => undefined,
        onSignal: () => undefined,
      },
      plainStyle,
    );
    const host = createHostServer({
      cwd: box.repo,
      send: (method, params) => call(ctx, method as Method, params as never),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await host.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'swarm_status', arguments: {} });
    expect(result.isError).not.toBe(true);
  });

  it('warns once when the server runs another version', async () => {
    const fake = createHttpServer((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ pong: true, build: { version: '0.0.0-other' } }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    let stderr = '';
    const io: CliIo = {
      cwd: process.cwd(),
      env: { AIP_SERVER: url, AIP_TOKEN: 'aip_pat_x' },
      isTTY: false,
      entry: [],
      pid: 1,
      stdout: () => undefined,
      stderr: (text) => void (stderr += text),
      setExitCode: () => undefined,
      exit: () => undefined,
      onSignal: () => undefined,
    };
    try {
      await daemon(context(io, plainStyle));
      expect(stderr).toContain('0.0.0-other');
    } finally {
      fake.close();
    }
  });
});
