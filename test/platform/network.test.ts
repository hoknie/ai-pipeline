import { createServer as createHttpServer, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { type Duplex } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { interfaceUp, probeHttp, probeTcp } from '../../src/platform/network/index.ts';

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function closing(server: Server | TcpServer): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      if ('closeAllConnections' in server) server.closeAllConnections();
      server.close(() => resolve());
    });
}

async function httpServer(status: number): Promise<number> {
  const server = createHttpServer((request, response) => {
    seen.push(request.headers);
    response.statusCode = status;
    response.end('x');
  });
  closers.push(closing(server));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

async function tcpServer(): Promise<number> {
  const server = createTcpServer((socket) => socket.on('error', () => undefined).end());
  closers.push(closing(server));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

async function freePort(): Promise<number> {
  const port = await tcpServer();
  await closers.pop()?.();
  return port;
}

const seen: Record<string, string | string[] | undefined>[] = [];

/** A proxy that tunnels `CONNECT` and forwards absolute-form requests; counts both. */
async function proxy(
  options: { to?: number; delay?: number } = {},
): Promise<{ port: number; connects: string[]; gets: string[]; open: () => Promise<number> }> {
  const connects: string[] = [];
  const gets: string[] = [];
  const sockets: Duplex[] = [];
  const server = createHttpServer((request, response) => {
    gets.push(request.url ?? '');
    response.statusCode = 404;
    response.end('proxy');
  });
  server.on('connect', (request, socket) => {
    sockets.push(socket);
    connects.push(request.url ?? '');
    const [host, port] = (request.url ?? '').split(':');
    const open = (): void => {
      const upstream = createTcpConnection(
        options.to === undefined ? (host ?? '') : '127.0.0.1',
        options.to ?? Number(port),
        socket,
      );
      upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    };
    if (options.delay === undefined) open();
    else setTimeout(open, options.delay);
  });
  closers.push(() => {
    for (const socket of sockets) socket.destroy();
    return closing(server)();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    connects,
    gets,
    open: () =>
      new Promise((resolve) => {
        server.getConnections((_error, count) => resolve(count));
      }),
  };
}

function createTcpConnection(host: string, port: number, client: Duplex) {
  const upstream = connect({ host, port }, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(client);
    client.pipe(upstream);
  });
  client.on('error', () => upstream.destroy());
  return upstream;
}

describe('probeTcp', () => {
  it('succeeds on an open port and fails on a closed one', async () => {
    const port = await tcpServer();
    expect(await probeTcp('127.0.0.1', port, 1000)).toEqual({ ok: true });
    const closed = await freePort();
    const result = await probeTcp('127.0.0.1', closed, 1000);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.problem).toContain(`127.0.0.1:${closed}`);
  });

  it('fails when the connection takes longer than the timeout', async () => {
    const result = await probeTcp('10.255.255.1', 81, 100);
    expect(result.ok).toBe(false);
  });

  it('goes through the proxy with CONNECT', async () => {
    const port = await tcpServer();
    const via = await proxy();
    const result = await probeTcp('127.0.0.1', port, 1000, `http://127.0.0.1:${via.port}`);
    expect(result).toEqual({ ok: true });
    expect(via.connects).toEqual([`127.0.0.1:${port}`]);
  });

  it('fails when the proxy is down, naming it without credentials', async () => {
    const dead = await freePort();
    const result = await probeTcp('127.0.0.1', 80, 1000, `http://user:secret@127.0.0.1:${dead}`);
    expect(result.ok).toBe(false);
    const problem = result.ok ? '' : result.problem;
    expect(problem).toContain(`http://127.0.0.1:${dead}`);
    expect(problem).not.toContain('secret');
  });

  it('fails when the proxy refuses CONNECT', async () => {
    const refusing = createHttpServer();
    refusing.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
    closers.push(closing(refusing));
    await new Promise<void>((resolve) => refusing.listen(0, '127.0.0.1', resolve));
    const port = (refusing.address() as { port: number }).port;
    const result = await probeTcp('127.0.0.1', 80, 1000, `http://127.0.0.1:${port}`);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.problem).toContain('HTTP 403');
  });
});

describe('probeHttp', () => {
  it('treats 404 and 401 as reachable', async () => {
    for (const status of [200, 401, 404]) {
      const port = await httpServer(status);
      expect(await probeHttp(`http://127.0.0.1:${port}/v1`, 1000)).toEqual({ ok: true });
    }
  });

  it('treats 403, 407 and 5xx as unreachable', async () => {
    for (const status of [403, 407, 503]) {
      const port = await httpServer(status);
      const url = `http://127.0.0.1:${port}`;
      const result = await probeHttp(url, 1000);
      expect(result).toEqual({ ok: false, problem: `${url}: HTTP ${status}` });
    }
  });

  it('sends no authorization headers', async () => {
    seen.length = 0;
    const port = await httpServer(200);
    await probeHttp(`http://127.0.0.1:${port}`, 1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('authorization');
    expect(seen[0]).not.toHaveProperty('x-api-key');
  });

  it('fails on a timeout and on a closed port', async () => {
    const sockets: { destroy(): void }[] = [];
    const silent = createTcpServer((socket) => sockets.push(socket));
    closers.push(async () => {
      sockets.forEach((socket) => socket.destroy());
      await closing(silent)();
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as { port: number }).port;
    const slow = await probeHttp(`http://127.0.0.1:${port}`, 150);
    expect(slow.ok).toBe(false);
    expect(slow.ok ? '' : slow.problem).toContain('timeout');
    expect((await probeHttp(`http://127.0.0.1:${await freePort()}`, 1000)).ok).toBe(false);
  });

  it('goes through the proxy and fails when it is down', async () => {
    const via = await proxy();
    const result = await probeHttp(
      'http://example.invalid/x',
      1000,
      `http://127.0.0.1:${via.port}`,
    );
    expect(result).toEqual({ ok: true });
    expect(via.gets).toEqual(['http://example.invalid/x']);
    const dead = await freePort();
    const down = await probeHttp('http://example.invalid/x', 1000, `http://127.0.0.1:${dead}`);
    expect(down.ok ? '' : down.problem).toContain(`http://127.0.0.1:${dead}`);
  });
});

describe('probeHttp over a tunnel', () => {
  /** A TCP server that counts connections and answers with bytes that are not TLS. */
  async function notTls(silent = false): Promise<{ port: number; accepted: number[] }> {
    const accepted: number[] = [];
    const sockets: Duplex[] = [];
    const server = createTcpServer((socket) => {
      accepted.push(1);
      sockets.push(socket);
      socket.on('error', () => undefined);
      if (!silent) socket.end('not tls\r\n');
    });
    closers.push(() => {
      for (const socket of sockets) socket.destroy();
      return closing(server)();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as { port: number }).port, accepted };
  }

  it('sends the HTTPS request through the tunnel, not directly, and closes it', async () => {
    const target = await notTls();
    const via = await proxy({ to: target.port });
    const proxyAddress = `http://127.0.0.1:${via.port}`;
    const result = await probeHttp('https://example.invalid', 1000, proxyAddress);
    expect(result.ok).toBe(false);
    const problem = result.ok ? '' : result.problem;
    expect(problem).toContain(`via ${proxyAddress}`);
    expect(problem).not.toMatch(/ENOTFOUND|getaddrinfo/);
    expect(via.connects).toEqual(['example.invalid:443']);
    expect(target.accepted).toHaveLength(1);
    const deadline = Date.now() + 200;
    let open = await via.open();
    while (open > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      open = await via.open();
    }
    expect(open).toBe(0);
  });

  it('spends one timeout on the tunnel and the request together', async () => {
    const target = await notTls(true);
    const via = await proxy({ to: target.port, delay: 150 });
    const started = Date.now();
    const result = await probeHttp('https://example.invalid', 250, `http://127.0.0.1:${via.port}`);
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('gives a TCP probe through a proxy that never answers CONNECT one timeout', async () => {
    const silent = await notTls(true);
    const started = Date.now();
    const result = await probeTcp('example.invalid', 443, 250, `http://127.0.0.1:${silent.port}`);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain('no answer in 250 ms');
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe('interfaceUp', () => {
  it('is false for a missing interface and for the loopback one', () => {
    expect(interfaceUp('aip-no-such-interface')).toBe(false);
    const loopback = Object.entries(networkInterfaces()).find(([, list]) =>
      list?.every((address) => address.internal),
    );
    if (loopback) expect(interfaceUp(loopback[0])).toBe(false);
  });

  it('is true for an interface with an external address', () => {
    const external = Object.entries(networkInterfaces()).find(([, list]) =>
      list?.some((address) => !address.internal),
    );
    if (external) expect(interfaceUp(external[0])).toBe(true);
  });
});
