import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openWebSocket,
  webSocketFailureCode,
  type WebSocketClosed,
  type WebSocketConnection,
} from '../../src/platform/http/index.ts';
import { acceptWebSocket, serverFrame, type WsPeer } from '../fakes/ws-server.ts';

const sockets = new Set<Socket>();
const servers: Server[] = [];
const open: WebSocketConnection[] = [];

afterEach(() => {
  for (const connection of open.splice(0)) connection.close();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) server.close();
});

function track(server: Server): void {
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
}

/** A WebSocket server on loopback; the peers come in the order they connect. */
async function wsServer(options: { badAccept?: boolean } = {}) {
  const peers: WsPeer[] = [];
  const paths: string[] = [];
  const server = createServer();
  track(server);
  server.on('upgrade', (request, socket) => {
    paths.push(request.url ?? '');
    peers.push(acceptWebSocket(request, socket, options));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, peers, paths };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function client(url: string, extra: Partial<Parameters<typeof openWebSocket>[0]> = {}) {
  const messages: string[] = [];
  const pongs: string[] = [];
  const closes: WebSocketClosed[] = [];
  const connection = await openWebSocket({
    url,
    timeoutMs: 2000,
    onMessage: (text) => messages.push(text),
    onPong: (payload) => pongs.push(payload.toString()),
    onClose: (closed) => closes.push(closed),
    ...extra,
  });
  open.push(connection);
  return { connection, messages, pongs, closes };
}

describe('openWebSocket', () => {
  it('sends masked text, receives text and keeps the path and the query', async () => {
    const server = await wsServer();
    const { connection, messages } = await client(`ws://127.0.0.1:${server.port}/link?ticket=1`);
    await until(() => server.peers.length === 1, 'peer');
    connection.send('héllo');
    server.peers[0]!.sendText('привет');
    await until(() => messages.length === 1 && server.peers[0]!.received.length === 1, 'both');
    expect(messages).toEqual(['привет']);
    expect(server.peers[0]!.received).toEqual(['héllo']);
    expect(server.peers[0]!.allMasked).toBe(true);
    expect(server.paths).toEqual(['/link?ticket=1']);
  });

  it('sends a long message in a frame with a 64-bit length', async () => {
    const server = await wsServer();
    const { connection } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    const long = 'x'.repeat(70_000);
    connection.send(long);
    await until(() => server.peers[0]!.received.length === 1, 'received');
    expect(server.peers[0]!.received[0]).toBe(long);
  });

  it('puts a fragmented message together, even with a ping in the middle', async () => {
    const server = await wsServer();
    const { messages } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    const peer = server.peers[0]!;
    peer.sendFrame(0x1, Buffer.from('one '), false);
    peer.ping('between');
    peer.sendFrame(0x0, Buffer.from('two '), false);
    peer.sendFrame(0x0, Buffer.from('three'), true);
    await until(() => messages.length === 1, 'message');
    expect(messages).toEqual(['one two three']);
    expect(peer.pongs).toEqual(['between']);
  });

  it('answers a ping with a pong of the same payload and reports a pong', async () => {
    const server = await wsServer();
    const { connection, pongs } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    server.peers[0]!.ping('are you there');
    await until(() => server.peers[0]!.pongs.length === 1, 'pong');
    expect(server.peers[0]!.pongs).toEqual(['are you there']);
    connection.ping('mine');
    await until(() => pongs.length === 1, 'our pong');
    expect(pongs).toEqual(['mine']);
  });

  it('reports the close of the server with its code and answers it', async () => {
    const server = await wsServer();
    const { closes } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    server.peers[0]!.close(1001);
    await until(() => closes.length === 1, 'close');
    expect(closes[0]).toMatchObject({ code: 1001 });
    expect(server.peers[0]!.closedBy).toBe(1001);
  });

  it('reports a connection dropped without a close frame as 1006', async () => {
    const server = await wsServer();
    const { closes } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    server.peers[0]!.destroy();
    await until(() => closes.length === 1, 'close');
    expect(closes[0]!.code).toBe(1006);
  });

  it('closes with its own handshake when asked', async () => {
    const server = await wsServer();
    const { connection, closes } = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 1, 'peer');
    connection.close(1000);
    await until(() => closes.length === 1, 'close');
    expect(server.peers[0]!.closedBy).toBe(1000);
    expect(closes).toHaveLength(1);
  });

  it('refuses a message over the limit with 1009, whole or in fragments', async () => {
    const server = await wsServer();
    const first = await client(`ws://127.0.0.1:${server.port}/`, { maxMessageBytes: 1024 });
    const second = await client(`ws://127.0.0.1:${server.port}/`, { maxMessageBytes: 1024 });
    await until(() => server.peers.length === 2, 'peers');
    server.peers[0]!.sendText('x'.repeat(2000));
    server.peers[1]!.sendFrame(0x1, Buffer.from('y'.repeat(700)), false);
    server.peers[1]!.sendFrame(0x0, Buffer.from('y'.repeat(700)), true);
    await until(() => first.closes.length === 1 && second.closes.length === 1, 'closes');
    expect(first.messages).toEqual([]);
    expect(second.messages).toEqual([]);
    expect(first.closes[0]!.code).toBe(1009);
    expect(second.closes[0]!.code).toBe(1009);
    expect(server.peers[0]!.closedBy).toBe(1009);
  });

  it('closes on a binary frame and on a reserved bit', async () => {
    const server = await wsServer();
    const binary = await client(`ws://127.0.0.1:${server.port}/`);
    const reserved = await client(`ws://127.0.0.1:${server.port}/`);
    await until(() => server.peers.length === 2, 'peers');
    server.peers[0]!.sendFrame(0x2, Buffer.from('bin'));
    const frame = serverFrame(0x1, Buffer.from('x'));
    frame[0] = frame[0]! | 0x40;
    server.peers[1]!.raw.write(frame);
    await until(() => binary.closes.length === 1 && reserved.closes.length === 1, 'closes');
    expect(binary.closes[0]!.code).toBe(1003);
    expect(reserved.closes[0]!.code).toBe(1002);
  });

  it('refuses a handshake with a wrong Sec-WebSocket-Accept', async () => {
    const server = await wsServer({ badAccept: true });
    const error = await openWebSocket({
      url: `ws://127.0.0.1:${server.port}/secret-ticket`,
      timeoutMs: 2000,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    expect(webSocketFailureCode(error)).toBe('handshake');
    expect(String((error as Error).message)).not.toContain('secret-ticket');
  });

  it('refuses a server that answers without an upgrade', async () => {
    const server = createServer((_request, response) => response.end('no'));
    track(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const error = await openWebSocket({
      url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      timeoutMs: 2000,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    expect(webSocketFailureCode(error)).toBe('handshake');
  });

  it('gives up when the handshake does not end in time', async () => {
    const server = createServer();
    track(server);
    server.on('upgrade', () => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const error = await openWebSocket({
      url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      timeoutMs: 150,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    expect(webSocketFailureCode(error)).toBe('timeout');
  });

  it('rejects addresses that are not ws or wss', async () => {
    const options = { timeoutMs: 100, onMessage: () => undefined, onClose: () => undefined };
    expect(
      webSocketFailureCode(
        await openWebSocket({ ...options, url: 'http://127.0.0.1/' }).catch((e: unknown) => e),
      ),
    ).toBe('unsupported_scheme');
    expect(
      webSocketFailureCode(
        await openWebSocket({ ...options, url: 'nonsense' }).catch((e: unknown) => e),
      ),
    ).toBe('invalid_url');
  });

  it('cancels the handshake and closes an open connection on abort', async () => {
    const silent = createServer();
    track(silent);
    silent.on('upgrade', () => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    const pending = openWebSocket({
      url: `ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`,
      timeoutMs: 5000,
      signal: controller.signal,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    setTimeout(() => controller.abort(), 30);
    expect(webSocketFailureCode(await pending)).toBe('aborted');

    const server = await wsServer();
    const live = new AbortController();
    const { closes } = await client(`ws://127.0.0.1:${server.port}/`, { signal: live.signal });
    await until(() => server.peers.length === 1, 'peer');
    live.abort();
    await until(() => closes.length === 1, 'closed after abort');
    expect(server.peers[0]!.closedBy).toBe(1000);

    const refused = await openWebSocket({
      url: `ws://127.0.0.1:${server.port}/`,
      timeoutMs: 1000,
      signal: live.signal,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    expect(webSocketFailureCode(refused)).toBe('aborted');
  });
});

/** A proxy that tunnels every CONNECT to the WebSocket server, whatever host the client names. */
async function proxy(target: number) {
  const connects: string[] = [];
  const server = createServer();
  track(server);
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, connects };
}

describe('openWebSocket through a proxy', () => {
  it('tunnels with CONNECT, so the proxy sees the host and the port but not the path', async () => {
    const server = await wsServer();
    const tunnel = await proxy(server.port);
    const { connection, messages } = await client('ws://socket.example.test:8080/link?ticket=abc', {
      proxy: `http://127.0.0.1:${tunnel.port}`,
    });
    await until(() => server.peers.length === 1, 'peer');
    connection.send('through');
    server.peers[0]!.sendText('back');
    await until(() => messages.length === 1 && server.peers[0]!.received.length === 1, 'both');
    expect(tunnel.connects).toEqual(['socket.example.test:8080']);
    expect(server.paths).toEqual(['/link?ticket=abc']);
  });

  it('goes straight to loopback even with a proxy set', async () => {
    const server = await wsServer();
    const tunnel = await proxy(server.port);
    await client(`ws://127.0.0.1:${server.port}/`, { proxy: `http://127.0.0.1:${tunnel.port}` });
    await until(() => server.peers.length === 1, 'peer');
    expect(tunnel.connects).toEqual([]);
  });

  it('reports a proxy that refuses the tunnel', async () => {
    const refusing = createServer();
    track(refusing);
    refusing.on('connect', (_request, client: Socket) => {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((resolve) => refusing.listen(0, '127.0.0.1', resolve));
    const error = await openWebSocket({
      url: 'ws://socket.example.test/',
      proxy: `http://127.0.0.1:${(refusing.address() as AddressInfo).port}`,
      timeoutMs: 2000,
      onMessage: () => undefined,
      onClose: () => undefined,
    }).catch((thrown: unknown) => thrown);
    expect(webSocketFailureCode(error)).toBe('proxy_refused');
  });
});
