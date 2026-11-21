import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { QueueView } from '../../src/presentation/ipc/contract/index.ts';
import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { harness, type Harness } from './harness.ts';

const KEY = Buffer.from('registry-signing-key-24b');
const SECRET = `whsec_${KEY.toString('base64')}`;
const PATH = 'acme/backend/api';

let h: Harness | null = null;
let web: WebServer | null = null;
let fake: FakeRegistry | null = null;
let logs: string[] = [];

afterEach(async () => {
  await web?.close();
  await h?.close();
  await fake?.close();
  web = h = fake = null;
});

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

function post(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (text += chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
        }),
      );
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

/** The headers of a delivery signed the way a registry signs it. */
function signed(id: string, body: string, key = KEY, seconds = Date.now() / 1000) {
  const timestamp = String(Math.floor(seconds));
  const mac = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${mac}`,
  };
}

const event = (type: string, extra: Record<string, unknown> = {}, path = PATH) =>
  JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data: { node: { path }, ...extra },
  });

async function setup(params: Record<string, string>, server?: { publicUrl: string }) {
  fake = await startFakeRegistry();
  fake.projects = [{ path: PATH, name: 'api', repo_url: 'https://github.com/acme/api' }];
  logs = [];
  h = await harness(
    undefined,
    {},
    { integrations: { secretStore: new MemoryStore() }, log: (line) => logs.push(line) },
  );
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], { cwd: h.repo });
  await h.call('repository_add', { path: h.repo });
  const added = (await h.call('integration_add', {
    kind: 'service-registry',
    name: 'main',
    global: true,
    params: { url: fake.base, ...params },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'token', value: fake.token });
  await h.call('integration_secret_set', { id: added.id, slot: 'webhook_secret', value: SECRET });
  await h.call('integration_enable', { id: added.id });
  await h.call('integration_link', { id: added.id, repository: h.repo, path: PATH });
  if (server !== undefined) {
    const directory = join(String(h.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'settings.yaml'),
      `server:\n  enabled: true\n  public_url: "${server.publicUrl}"\n`,
    );
  }
  web =
    server === undefined
      ? await startWebServer({ socket: h.socket, port: 0, repository: h.repo })
      : await startWebServer({
          socket: h.socket,
          host: '127.0.0.1',
          port: Number(new URL(server.publicUrl).port),
          server: { publicUrl: server.publicUrl, trustedProxies: [] },
        });
  const port = web.port;
  const hook = `/hooks/service-registry/${added.id}`;
  return {
    id: added.id,
    deliver: (id: string, body: string, headers = signed(id, body), path = hook) =>
      post(port, path, body, { ...headers }),
    port,
    queue: async () => ((await h!.call('queue', { repository: h!.repo })) as QueueView).items,
  };
}

describe('events of a service registry through the panel', () => {
  it('queues one task for a signed drift, answers a repeat and a same problem as such', async () => {
    const { deliver, queue } = await setup({ on_deployment_drift: 'feature' });
    const body = event('deployment.drift', { environment: 'prod', actual_version: '1' });
    const first = await deliver('msg_1', body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'applied' });
    expect(typeof first.body.item).toBe('string');
    const items = await queue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      pipeline: 'feature',
      title: 'Registry: deployment.drift — acme/backend/api',
    });
    expect(items[0]?.task).toContain('Environment: prod');
    expect(items[0]?.task).toContain(`${fake!.base}/catalog?node=`);
    expect(items[0]?.task).not.toContain('msg_1');

    expect(await deliver('msg_1', body)).toEqual({ status: 200, body: { status: 'duplicate' } });
    const same = await deliver('msg_2', body);
    expect(same).toEqual({ status: 200, body: { status: 'applied', duplicate: true } });
    const other = await deliver('msg_3', event('deployment.drift', { actual_version: '2' }));
    expect(other.body).toMatchObject({ status: 'applied' });
    expect(await queue()).toHaveLength(2);
  });

  it('refuses everything unauthenticated with one answer and queues nothing', async () => {
    const { deliver, queue, id } = await setup({ on_deployment_drift: 'feature' });
    const body = event('deployment.drift');
    const answers = [
      await deliver('msg_1', body, signed('msg_1', body, Buffer.from('another-key'))),
      await deliver('msg_1', body, signed('msg_1', body, KEY, Date.now() / 1000 - 600)),
      await deliver('msg_1', body, { 'content-type': 'application/json' } as never),
      await deliver('msg_1', body, signed('msg_1', body), '/hooks/service-registry/nope'),
    ];
    for (const answer of answers) {
      expect(answer).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    }
    await h!.call('integration_secret_remove', { id, slot: 'webhook_secret' });
    expect((await deliver('msg_1', body)).status).toBe(401);
    expect(await queue()).toEqual([]);
  });

  it('records events that ask for nothing as ignored, with the reason', async () => {
    const { deliver, queue } = await setup({ on_deployment_drift: 'feature' });
    const cases: [string, string, string, string][] = [
      ['msg_1', 'deployment.drift_resolved', PATH, 'recovery'],
      ['msg_2', 'link.check_failed', PATH, 'no_rule'],
      ['msg_3', 'node.created', PATH, 'unsupported'],
      ['msg_4', 'deployment.drift', 'acme/other', 'no_link'],
    ];
    for (const [id, type, path, reason] of cases) {
      const answer = await deliver(id, event(type, {}, path));
      expect(answer).toEqual({ status: 200, body: { status: 'ignored', reason } });
    }
    const malformed = '{"type":"deployment.drift"}';
    expect((await deliver('msg_5', malformed)).body).toEqual({
      status: 'ignored',
      reason: 'malformed',
    });
    expect(await queue()).toEqual([]);
  });

  it('refuses an unknown pipeline and takes the event once the rule is fixed', async () => {
    const { deliver, queue, id } = await setup({ on_repo_sync_failed: 'missing' });
    const body = event('repo_sync.failed', { error: 'denied' });
    expect(await deliver('msg_1', body)).toEqual({
      status: 422,
      body: { error: 'operation_denied' },
    });
    await h!.call('integration_edit', { id, set: { on_repo_sync_failed: 'feature' } });
    expect((await deliver('msg_1', body)).body).toMatchObject({ status: 'applied' });
    expect(await queue()).toHaveLength(1);
  });

  it('answers 405, 413 and 404 without the daemon, and 503 without it', async () => {
    const { deliver, port, id } = await setup({ on_deployment_drift: 'feature' });
    const hook = `/hooks/service-registry/${id}`;
    expect((await post(port, hook, '', {}, 'GET')).status).toBe(405);
    expect((await post(port, '/hooks/other', '{}')).status).toBe(404);
    const big = 'x'.repeat(1024 * 1024 + 1);
    expect((await deliver('msg_1', big, signed('msg_1', big))).status).toBe(413);
    // a host of another name is no better than for any request of the panel
    const foreign = await post(port, hook, '{}', { host: 'hooks.example.com' });
    expect(foreign.status).toBe(403);
    await h!.close();
    const body = event('deployment.drift');
    expect(await deliver('msg_2', body)).toEqual({ status: 503, body: { error: 'unavailable' } });
  });

  it('writes one line of the log of the daemon for a checked event, without body or signature', async () => {
    const { deliver } = await setup({ on_deployment_drift: 'feature' });
    const body = event('repo_sync.recovered');
    const headers = signed('msg_1', body);
    await deliver('msg_1', body, headers);
    const lines = logs.filter((line) => line.includes('integration event'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('type=repo_sync.recovered path=acme/backend/api');
    expect(lines[0]).toContain('outcome=ignored recovery');
    expect(lines[0]).not.toContain(headers['webhook-signature']);
    expect(lines[0]).not.toContain('timestamp');
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

describe('events in the server mode', () => {
  it('takes a signed delivery without a session and without an origin', async () => {
    const port = await freePort();
    const publicUrl = `http://127.0.0.1:${port}`;
    const { id, queue } = await setup({ on_deployment_drift: 'feature' }, { publicUrl });
    const path = `/hooks/service-registry/${id}`;
    const body = event('deployment.drift', { environment: 'prod' });
    const first = await post(port, path, body, signed('msg_1', body));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'applied' });
    expect(await queue()).toHaveLength(1);
    const foreign = { ...signed('msg_2', body), origin: 'https://evil.example.com' };
    expect((await post(port, path, body, foreign)).status).toBe(200);
    const bad = signed('msg_3', body, Buffer.from('another-key'));
    expect(await post(port, path, body, bad)).toEqual({
      status: 401,
      body: { error: 'unauthenticated' },
    });
    expect(await queue()).toHaveLength(1);
  });

  it('reach the check of the signature without a session and without an origin', async () => {
    const port = await freePort();
    const publicUrl = `http://127.0.0.1:${port}`;
    fake = await startFakeRegistry();
    h = await harness(undefined, {}, { integrations: { secretStore: new MemoryStore() } });
    const directory = join(String(h.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'settings.yaml'),
      `server:\n  enabled: true\n  public_url: "${publicUrl}"\n`,
    );
    web = await startWebServer({
      socket: h.socket,
      host: '127.0.0.1',
      port,
      server: { publicUrl, trustedProxies: [] },
    });
    const body = event('deployment.drift');
    const path = '/hooks/service-registry/nope';
    const withOrigin = { ...signed('msg_1', body), origin: 'https://evil.example.com' };
    expect(await post(port, path, body, signed('msg_1', body))).toEqual({
      status: 401,
      body: { error: 'unauthenticated' },
    });
    expect((await post(port, path, body, withOrigin)).status).toBe(401);
    const foreignHost = await post(port, path, body, { host: 'hooks.example.com' });
    expect(foreignHost.status).toBe(403);
    // the rest of the panel still wants a session and its own origin
    expect((await post(port, '/api/ipc', '{}', { origin: publicUrl })).status).toBe(401);
    expect((await post(port, '/api/ipc', '{}')).status).toBe(403);
  });
});
