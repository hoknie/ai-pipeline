import { afterEach, describe, expect, it } from 'vitest';

import { createServer, type Server } from 'node:http';

import {
  MAX_RESPONSE_BYTES,
  mcpClose,
  mcpPost,
} from '../../../src/feature/service-registry/clients/http-mcp/index.ts';
import type { McpEndpoint } from '../../../src/feature/service-registry/types/index.ts';
import { RegistryFailure } from '../../../src/feature/service-registry/types/index.ts';
import {
  startFakeProxy,
  startFakeRegistry,
  type FakeProxy,
  type FakeRegistry,
} from '../../fakes/registry-api.ts';

let registry: FakeRegistry | null = null;
let proxy: FakeProxy | null = null;
let extra: Server | null = null;

afterEach(async () => {
  await proxy?.close();
  await registry?.close();
  await new Promise<void>((resolve) => (extra ? extra.close(() => resolve()) : resolve()));
  registry = proxy = null;
  extra = null;
});

async function start(): Promise<{ fake: FakeRegistry; endpoint: McpEndpoint }> {
  registry = await startFakeRegistry();
  return {
    fake: registry,
    endpoint: { base: registry.base, token: registry.token, proxyFor: () => null },
  };
}

const list = { jsonrpc: '2.0', id: 7, method: 'tools/list' };

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryFailure);
    return (error as RegistryFailure).code;
  }
  return 'none';
}

describe('http mcp client', () => {
  it('posts with the bearer token and reads a JSON answer by id', async () => {
    const { fake, endpoint } = await start();
    const reply = await mcpPost(endpoint, list);
    expect(reply.message).toMatchObject({ id: 7, result: { tools: expect.any(Array) } });
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/mcp',
      authorization: `Bearer ${fake.token}`,
    });
  });

  it('reads the first event with the id of the request from an SSE stream', async () => {
    const { fake, endpoint } = await start();
    fake.mode = 'sse';
    const reply = await mcpPost(endpoint, list);
    expect(reply.message).toMatchObject({ id: 7 });
  });

  it('keeps the session id and closes the session with DELETE', async () => {
    const { fake, endpoint } = await start();
    const opened = await mcpPost(endpoint, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(opened.sessionId).toBe('session-1');
    const session = { ...endpoint, sessionId: opened.sessionId };
    await mcpPost(session, list);
    expect(fake.requests[1]?.sessionId).toBe('session-1');
    await mcpClose(session);
    expect(fake.closed).toEqual(['session-1']);
    await mcpClose(endpoint);
    expect(fake.closed).toHaveLength(1);
  });

  it('has no answer for a notification', async () => {
    const { endpoint } = await start();
    const reply = await mcpPost(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(reply.message).toBeNull();
  });

  it('answers unauthorized for 401 and 403 without the body or the token', async () => {
    const { fake, endpoint } = await start();
    fake.failWith.push(403);
    expect(await codeOf(mcpPost(endpoint, list))).toBe('unauthorized');
    const wrong = { ...endpoint, token: 'svcp_other' };
    try {
      await mcpPost(wrong, list);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'unauthorized', message: 'unauthorized' });
      expect(JSON.stringify(error)).not.toContain('secret detail');
      expect(String((error as Error).stack)).not.toContain(fake.token);
    }
  });

  it('maps server errors and throttling to unreachable and other statuses to protocol', async () => {
    const { fake, endpoint } = await start();
    for (const status of [429, 500, 503]) {
      fake.failWith.push(status);
      expect(await codeOf(mcpPost(endpoint, list))).toBe('unreachable');
    }
    fake.failWith.push(418);
    expect(await codeOf(mcpPost(endpoint, list))).toBe('protocol');
  });

  it('answers protocol for a body that is not JSON-RPC or has no answer for the id', async () => {
    const { fake, endpoint } = await start();
    fake.rawBody = 'not json';
    expect(await codeOf(mcpPost(endpoint, list))).toBe('protocol');
    fake.rawBody = JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} });
    expect(await codeOf(mcpPost(endpoint, list))).toBe('protocol');
  });

  it('answers too_large above the limit', async () => {
    const { fake, endpoint } = await start();
    fake.rawBody = JSON.stringify({ id: 7, result: 'x'.repeat(MAX_RESPONSE_BYTES) });
    expect(await codeOf(mcpPost(endpoint, list))).toBe('too_large');
  });

  it('answers timeout when the registry holds the request', async () => {
    const { fake, endpoint } = await start();
    fake.delayMs = 500;
    expect(await codeOf(mcpPost({ ...endpoint, timeoutMs: 50 }, list))).toBe('timeout');
  });

  it('answers unreachable when nothing listens', async () => {
    const { fake, endpoint } = await start();
    await fake.close();
    registry = null;
    expect(await codeOf(mcpPost(endpoint, list))).toBe('unreachable');
  });

  it('answers unreachable when the request is cancelled', async () => {
    const { fake, endpoint } = await start();
    fake.delayMs = 500;
    const controller = new AbortController();
    const work = mcpPost({ ...endpoint, signal: controller.signal }, list);
    controller.abort();
    expect(await codeOf(work)).toBe('unreachable');
  });
});

describe('http mcp client through a proxy', () => {
  it('tunnels a request to a named host through the proxy with CONNECT', async () => {
    const { fake } = await start();
    proxy = await startFakeProxy(fake.port, 'user:pa%24s');
    const seen: string[] = [];
    const reply = await mcpPost(
      {
        base: 'http://registry.test:8080',
        token: fake.token,
        proxyFor: (url) => {
          seen.push(url);
          return proxy!.url;
        },
      },
      list,
    );
    expect(reply.message).toMatchObject({ id: 7 });
    expect(seen).toEqual(['http://registry.test:8080/api/mcp']);
    expect(proxy.connects).toEqual([
      {
        target: 'registry.test:8080',
        authorization: `Basic ${Buffer.from('user:pa$s').toString('base64')}`,
      },
    ]);
  });

  it('asks for the proxy at every request and goes direct on null', async () => {
    const { fake, endpoint } = await start();
    proxy = await startFakeProxy(fake.port);
    let current: string | null = null;
    let base = endpoint.base;
    const moving = { ...endpoint, proxyFor: () => current };
    expect((await mcpPost({ ...moving, base }, list)).message).toMatchObject({ id: 7 });
    expect(proxy.connects).toHaveLength(0);
    // the settings changed: the next request is tunnelled without rebuilding anything
    current = proxy.url;
    base = 'http://registry.test:8080';
    expect((await mcpPost({ ...moving, base }, list)).message).toMatchObject({ id: 7 });
    expect(proxy.connects).toHaveLength(1);
    current = null;
    base = endpoint.base;
    expect((await mcpPost({ ...moving, base }, list)).message).toMatchObject({ id: 7 });
    expect(proxy.connects).toHaveLength(1);
  });

  it('reaches loopback directly even when a proxy is set', async () => {
    const { fake, endpoint } = await start();
    proxy = await startFakeProxy(fake.port);
    await mcpPost({ ...endpoint, proxyFor: () => proxy!.url }, list);
    expect(proxy.connects).toEqual([]);
  });

  it('answers unreachable for a socks5 proxy without opening a connection', async () => {
    const { fake, endpoint } = await start();
    const code = await codeOf(
      mcpPost(
        {
          ...endpoint,
          base: 'http://registry.test:8080',
          proxyFor: () => 'socks5://127.0.0.1:1080',
        },
        list,
      ),
    );
    expect(code).toBe('unreachable');
    expect(fake.requests).toEqual([]);
  });

  it('keeps the credentials of the proxy out of the error', async () => {
    const { endpoint } = await start();
    extra = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => extra!.once('listening', resolve));
    const port = (extra.address() as { port: number }).port;
    extra.on('connect', (_request, socket) => socket.end('HTTP/1.1 407 Denied\r\n\r\n'));
    try {
      await mcpPost(
        {
          ...endpoint,
          base: 'http://registry.test:8080',
          proxyFor: () => `http://login:hunter2@127.0.0.1:${port}`,
        },
        list,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'unreachable' });
      const text = `${(error as Error).message}${(error as Error).stack}`;
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('login');
    }
  });
});
