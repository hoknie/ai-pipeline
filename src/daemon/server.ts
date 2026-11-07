import { errorMessage } from '../platform/errors/index.ts';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  type Stats,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';

import { parseRequest, type Response } from '../protocol/index.ts';

import type { Daemon } from './daemon.ts';

const SUBSCRIBER_BUFFER_LIMIT = 4 * 1024 * 1024;
/** How often the daemon checks that its socket file and its lock are still in place. */
export const SOCKET_CHECK_MS = 5_000;

/** The file at `path` is the socket the daemon listens on (not removed, not replaced). */
function sameFile(path: string, own: Stats): boolean {
  try {
    const current = statSync(path);
    return current.dev === own.dev && current.ino === own.ino;
  } catch {
    return false;
  }
}

/** The lock at `path` holds the pid of this process. */
function ownLock(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').trim() === String(process.pid);
  } catch {
    return false;
  }
}

export interface ServeOptions {
  /** The lock file of the daemon: it must stay in place while the daemon runs. */
  lockPath: string;
  socketCheckMs?: number;
}

export interface ServedDaemon {
  close(): Promise<void>;
  closed: Promise<void>;
}

interface Serving {
  daemon: Daemon;
  server: Server;
  lockPath: string;
  subscriptions: Set<Socket>;
  own: Stats | null;
  socketCheck: NodeJS.Timeout | null;
  closing: Promise<void> | null;
}

async function answer(daemon: Daemon, line: string): Promise<Response> {
  const parsed = parseRequest(line);
  if ('error' in parsed) return { id: parsed.id, ok: false, error: parsed.error };
  try {
    return { id: parsed.id, ok: true, result: await daemon.handle(parsed.request) };
  } catch (error) {
    return { id: parsed.id, ok: false, error: errorMessage(error) };
  }
}

/** Sends events to a subscribed connection; a connection that falls behind is dropped. */
function subscribeConnection(serving: Serving, connection: Socket): void {
  const unsubscribe = serving.daemon.subscribe((event) => {
    if (connection.destroyed) return;
    if (connection.writableLength > SUBSCRIBER_BUFFER_LIMIT) {
      connection.destroy();
      return;
    }
    connection.write(`${event}\n`);
  });
  serving.subscriptions.add(connection);
  connection.once('close', () => {
    unsubscribe();
    serving.subscriptions.delete(connection);
  });
}

function handleLine(serving: Serving, connection: Socket, line: string, close: () => void): void {
  const parsed = parseRequest(line);
  if ('request' in parsed && parsed.request.method === 'subscribe') {
    subscribeConnection(serving, connection);
    return;
  }
  void answer(serving.daemon, line).then((response) => {
    if (!connection.destroyed) connection.write(`${JSON.stringify(response)}\n`);
    if (response.ok && (response.result as { stopping?: boolean })?.stopping) close();
  });
}

function handleConnection(serving: Serving, connection: Socket, close: () => void): void {
  connection.setEncoding('utf8');
  let buffer = '';
  connection.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      handleLine(serving, connection, line, close);
      end = buffer.indexOf('\n');
    }
  });
  connection.on('error', () => undefined);
}

async function shutdown(serving: Serving): Promise<void> {
  const { daemon, server, lockPath, own } = serving;
  if (serving.socketCheck) clearInterval(serving.socketCheck);
  for (const connection of serving.subscriptions) connection.destroy();
  // Closing a listening Unix socket unlinks its path, whatever file is there now: a file put in
  // place of the socket by someone else is moved aside for the close and then put back.
  const foreign = own !== null && existsSync(daemon.socket) && !sameFile(daemon.socket, own);
  const aside = `${daemon.socket}.${process.pid}.keep`;
  if (foreign) renameSync(daemon.socket, aside);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (foreign) renameSync(aside, daemon.socket);
  await daemon.stop();
  if (own && sameFile(daemon.socket, own)) rmSync(daemon.socket, { force: true });
  if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
    rmSync(lockPath, { force: true });
  }
}

/**
 * Without its socket nobody can reach the daemon; without its lock the next client starts
 * another one. Either is gone when the state directory is removed (the socket may live in the
 * temporary directory, see `socketPath`): the daemon then stops by itself.
 */
function watchSocket(serving: Serving, socketStat: Stats, intervalMs: number, close: () => void) {
  const { daemon, lockPath } = serving;
  serving.socketCheck = setInterval(() => {
    if (serving.closing) return;
    const lost = !sameFile(daemon.socket, socketStat)
      ? `socket ${daemon.socket}`
      : !ownLock(lockPath)
        ? `lock ${lockPath}`
        : null;
    if (lost === null) return;
    process.stderr.write(`aip daemon: ${lost} is gone; stopping\n`);
    close();
  }, intervalMs);
  serving.socketCheck.unref();
}

/** Listens on the socket of the daemon and starts it; the caller holds the lock. */
export async function serveDaemon(daemon: Daemon, options: ServeOptions): Promise<ServedDaemon> {
  rmSync(daemon.socket, { force: true });
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const serving: Serving = {
    daemon,
    server: createServer((connection) => handleConnection(serving, connection, () => void close())),
    lockPath: options.lockPath,
    subscriptions: new Set(),
    own: null,
    socketCheck: null,
    closing: null,
  };
  const close = (): Promise<void> => {
    serving.closing ??= shutdown(serving).then(resolveClosed);
    return serving.closing;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      serving.server.once('error', reject);
      serving.server.listen(daemon.socket, () => resolve());
    });
    chmodSync(daemon.socket, 0o600);
    const socketStat = statSync(daemon.socket);
    serving.own = socketStat;
    await daemon.start();
    watchSocket(serving, socketStat, options.socketCheckMs ?? SOCKET_CHECK_MS, () => void close());
  } catch (error) {
    serving.server.close();
    throw error;
  }
  return { close, closed };
}
