import { createServer as createHttp, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { connect, type AddressInfo, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { bypassProxy, httpFailureCode, httpRequest } from '../../src/platform/http/index.ts';
import { TEST_CERT, TEST_KEY } from '../fixtures/tls.ts';

const servers: { close(): void }[] = [];
const sockets = new Set<Socket>();

afterEach(() => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) server.close();
});

interface Seen {
  method: string;
  url: string;
  body: string;
  headers: IncomingMessage['headers'];
}

function handler(seen: Seen[]) {
  return (request: IncomingMessage, response: import('node:http').ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString(),
        headers: request.headers,
      });
      if (request.url?.startsWith('/slow')) return;
      if (request.url?.startsWith('/big')) {
        response.end(Buffer.alloc(2 * 1024 * 1024, 'x'));
        return;
      }
      if (request.url?.startsWith('/moved')) {
        response.writeHead(302, { location: '/elsewhere' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  };
}

function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

async function plain(seen: Seen[] = []) {
  return { port: await listen(createHttp(handler(seen))), seen };
}

async function secure(seen: Seen[] = []) {
  const server = createHttps(
    { key: TEST_KEY, cert: TEST_CERT },
    handler(seen),
  ) as unknown as Server;
  return { port: await listen(server), seen };
}

/** A proxy that tunnels every CONNECT to the real server, whatever host the client names. */
async function proxy(target: number) {
  const connects: string[] = [];
  const server = createHttp();
  server.on('connect', (request, client: Socket) => {
    connects.push(request.url ?? '');
    const upstream = connect(target, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  return { port: await listen(server), connects };
}

describe('httpRequest', () => {
  it('sends a request and reads the answer over http and https', async () => {
    const seen: Seen[] = [];
    const http = await plain(seen);
    const https = await secure(seen);
    const first = await httpRequest({
      url: `http://127.0.0.1:${http.port}/path?x=1`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      timeoutMs: 2000,
    });
    expect(first.status).toBe(200);
    expect(JSON.parse(Buffer.from(first.body).toString())).toEqual({ ok: true });
    const second = await httpRequest({
      url: `https://localhost:${https.port}/secure`,
      timeoutMs: 2000,
      ca: TEST_CERT,
    });
    expect(second.status).toBe(200);
    expect(seen.map((one) => [one.method, one.url, one.body])).toEqual([
      ['POST', '/path?x=1', '{"a":1}'],
      ['GET', '/secure', ''],
    ]);
  });

  it('fails when the request does not end in time', async () => {
    const { port } = await plain();
    const started = Date.now();
    const error = await httpRequest({ url: `http://127.0.0.1:${port}/slow`, timeoutMs: 150 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(httpFailureCode(error)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses an answer over the limit', async () => {
    const { port } = await plain();
    const error = await httpRequest({
      url: `http://127.0.0.1:${port}/big`,
      timeoutMs: 2000,
      maxResponseBytes: 1024,
    }).catch((thrown: unknown) => thrown);
    expect(httpFailureCode(error)).toBe('too_large');
    const byDefault = await httpRequest({
      url: `http://127.0.0.1:${port}/big`,
      timeoutMs: 2000,
    }).catch((thrown: unknown) => thrown);
    expect(httpFailureCode(byDefault)).toBe('too_large');
    const fine = await httpRequest({
      url: `http://127.0.0.1:${port}/big`,
      timeoutMs: 2000,
      maxResponseBytes: 4 * 1024 * 1024,
    });
    expect(fine.status).toBe(200);
    expect(fine.body.byteLength).toBe(2 * 1024 * 1024);
  });

  it('returns a redirect as an ordinary answer and does not follow it', async () => {
    const seen: Seen[] = [];
    const { port } = await plain(seen);
    const response = await httpRequest({ url: `http://127.0.0.1:${port}/moved`, timeoutMs: 2000 });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/elsewhere');
    expect(seen.map((one) => one.url)).toEqual(['/moved']);
  });

  it('refuses another scheme before it connects', async () => {
    const error = await httpRequest({ url: 'ftp://127.0.0.1:1/file', timeoutMs: 100 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(httpFailureCode(error)).toBe('unsupported_scheme');
    const bad = await httpRequest({ url: 'not a url', timeoutMs: 100 }).catch(
      (thrown: unknown) => thrown,
    );
    expect(httpFailureCode(bad)).toBe('invalid_url');
  });

  it('never puts the path, the query or a token in an error', async () => {
    const closed = await plain();
    servers.pop()?.close();
    const secret = 'bot123456:SECRET-TOKEN';
    for (const url of [
      `http://127.0.0.1:${closed.port}/${secret}/sendMessage?key=${secret}`,
      `http://127.0.0.1:${closed.port}/${secret}`,
    ]) {
      const error = (await httpRequest({ url, timeoutMs: 500 }).catch(
        (thrown: unknown) => thrown,
      )) as Error;
      expect(httpFailureCode(error)).toBe('network');
      expect(error.message).not.toContain('SECRET');
      expect(error.message).not.toContain('127.0.0.1');
      expect(JSON.stringify(error)).not.toContain('SECRET');
    }
    const timeout = (await httpRequest({
      url: `http://127.0.0.1:${(await plain()).port}/slow/${secret}`,
      timeoutMs: 100,
    }).catch((thrown: unknown) => thrown)) as Error;
    expect(timeout.message).not.toContain('SECRET');
    const scheme = (await httpRequest({ url: `ftp://host/${secret}`, timeoutMs: 100 }).catch(
      (thrown: unknown) => thrown,
    )) as Error;
    expect(scheme.message).not.toContain('SECRET');
  });
});

describe('through a proxy', () => {
  it('tunnels http with CONNECT, so the proxy sees the host and port but not the path', async () => {
    const seen: Seen[] = [];
    const server = await plain(seen);
    const tunnel = await proxy(server.port);
    const response = await httpRequest({
      url: `http://example.test:${server.port}/secret/path?token=abc`,
      timeoutMs: 2000,
      proxy: `http://127.0.0.1:${tunnel.port}`,
    });
    expect(response.status).toBe(200);
    expect(tunnel.connects).toEqual([`example.test:${server.port}`]);
    expect(seen.map((one) => one.url)).toEqual(['/secret/path?token=abc']);
    expect(seen[0]?.headers.host).toBe(`example.test:${server.port}`);
  });

  it('tunnels https with TLS to the real host over the tunnel', async () => {
    const seen: Seen[] = [];
    const server = await secure(seen);
    const tunnel = await proxy(server.port);
    const response = await httpRequest({
      url: `https://example.test:${server.port}/bot/secret`,
      timeoutMs: 2000,
      proxy: `http://127.0.0.1:${tunnel.port}`,
      ca: TEST_CERT,
    });
    expect(response.status).toBe(200);
    expect(tunnel.connects).toEqual([`example.test:${server.port}`]);
    expect(seen.map((one) => one.url)).toEqual(['/bot/secret']);
  });

  it('goes straight to loopback even with a proxy set: the proxy gets no connection', async () => {
    const seen: Seen[] = [];
    const server = await plain(seen);
    const tunnel = await proxy(server.port);
    for (const host of ['127.0.0.1', 'localhost']) {
      const response = await httpRequest({
        url: `http://${host}:${server.port}/direct`,
        timeoutMs: 2000,
        proxy: `http://127.0.0.1:${tunnel.port}`,
      });
      expect(response.status).toBe(200);
    }
    expect(tunnel.connects).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it('reaches ::1 directly too', async () => {
    const server = createHttp(handler([]));
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '::1', () => resolve((server.address() as AddressInfo).port));
    }).catch(() => 0);
    if (port === 0) return;
    const tunnel = await proxy(port);
    const response = await httpRequest({
      url: `http://[::1]:${port}/direct`,
      timeoutMs: 2000,
      proxy: `http://127.0.0.1:${tunnel.port}`,
    });
    expect(response.status).toBe(200);
    expect(tunnel.connects).toEqual([]);
  });

  it('reports a proxy that refuses the tunnel without naming anything', async () => {
    const refusing = createHttp();
    refusing.on('connect', (_request, client: Socket) => {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    const port = await listen(refusing);
    const error = (await httpRequest({
      url: 'http://example.test:80/bot/SECRET',
      timeoutMs: 1000,
      proxy: `http://127.0.0.1:${port}`,
    }).catch((thrown: unknown) => thrown)) as Error;
    expect(httpFailureCode(error)).toBe('proxy_refused');
    expect(error.message).not.toContain('SECRET');
    expect(error.message).not.toContain('example.test');
  });
});

describe('bypassProxy', () => {
  it('knows the loopback addresses', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(bypassProxy(host)).toBe(true);
    }
    for (const host of [
      'example.com',
      '128.0.0.1',
      '10.0.0.1',
      '1270.0.0.1',
      'localhost.example.com',
    ]) {
      expect(bypassProxy(host)).toBe(false);
    }
  });
});
