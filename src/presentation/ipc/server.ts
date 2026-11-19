import { isAppError } from '../../platform/errors/index.ts';
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

import {
  MAX_REQUEST_BYTES,
  ipcError,
  parseRequest,
  type IpcErrorCode,
  type Request,
  type Response,
} from './contract/index.ts';

/** What the socket serves: the requests, the subscriptions, the start and the stop. */
export interface ServedApplication {
  /** Path of the daemon socket. */
  readonly socket: string;
  handle(request: Request, actor?: string): Promise<unknown>;
  /** `logs`: the subscriber also gets the `log` events. */
  subscribe(send: (line: string) => void, logs?: boolean): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

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
  daemon: ServedApplication;
  server: Server;
  lockPath: string;
  subscriptions: Set<Socket>;
  own: Stats | null;
  socketCheck: NodeJS.Timeout | null;
  closing: Promise<void> | null;
}

/** A line for the daemon log: the stage and a fixed code, never a part of a request or of an error. */
function logFailure(stage: string, code: IpcErrorCode): void {
  process.stderr.write(`aip daemon: ipc ${stage} failed (${code})\n`);
}

/**
 * What a failing handler tells its client: an expected failure that its owner worded (a refused
 * state, an unknown name), or a fixed text. The message and the cause of any other exception may
 * hold what the request carried, so they are neither sent nor logged.
 */
function handlerFailure(error: unknown): { error: string; code: string } {
  if (isAppError(error) && error.kind !== 'internal') {
    return { error: error.message, code: error.code };
  }
  logFailure('handler', 'internal');
  return ipcError('internal');
}

type Parsed = ReturnType<typeof parseRequest>;

async function answer(daemon: ServedApplication, parsed: Parsed): Promise<Response> {
  if ('error' in parsed) {
    logFailure('request', parsed.code);
    return { id: parsed.id, ok: false, error: parsed.error, code: parsed.code };
  }
  try {
    return { id: parsed.id, ok: true, result: await daemon.handle(parsed.request, parsed.actor) };
  } catch (error) {
    if (isAppError(error) && (error.kind === 'unauthorized' || error.kind === 'forbidden')) {
      return {
        id: parsed.id,
        ok: false,
        error: error.message,
        kind: error.kind,
        ...(error.responseCode === undefined ? {} : { code: error.responseCode }),
      };
    }
    return { id: parsed.id, ok: false, ...handlerFailure(error) };
  }
}

/** Sends events to a subscribed connection; a connection that falls behind is dropped. */
function subscribeConnection(serving: Serving, connection: Socket, logs: boolean): void {
  const send = (event: string): void => {
    if (connection.destroyed) return;
    if (connection.writableLength > SUBSCRIBER_BUFFER_LIMIT) {
      connection.destroy();
      return;
    }
    connection.write(`${event}\n`);
  };
  const unsubscribe = serving.daemon.subscribe(send, logs);
  serving.subscriptions.add(connection);
  connection.once('close', () => {
    unsubscribe();
    serving.subscriptions.delete(connection);
  });
}

function handleLine(serving: Serving, connection: Socket, line: string, close: () => void): void {
  const parsed = parseRequest(line);
  if ('request' in parsed && parsed.request.method === 'subscribe') {
    subscribeConnection(serving, connection, parsed.request.params.logs === true);
    return;
  }
  void answer(serving.daemon, parsed).then((response) => {
    if (!connection.destroyed) connection.write(`${JSON.stringify(response)}\n`);
    if (response.ok && (response.result as { stopping?: boolean })?.stopping) close();
  });
}

/**
 * Reads the lines of a connection. What has piled up without a newline is limited in bytes before
 * anything parses it: a request that grows past the limit is answered with a fixed refusal and the
 * connection is closed, without the content being read, parsed, quoted or logged.
 */
function handleConnection(serving: Serving, connection: Socket, close: () => void): void {
  connection.setEncoding('utf8');
  let buffer = '';
  let pending = 0;
  let cutOff = false;
  connection.on('data', (chunk: string) => {
    if (cutOff) return;
    buffer += chunk;
    pending += Buffer.byteLength(chunk);
    let end = buffer.indexOf('\n', Math.max(0, buffer.length - chunk.length));
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      handleLine(serving, connection, line, close);
      end = buffer.indexOf('\n');
    }
    pending = Buffer.byteLength(buffer);
    if (pending <= MAX_REQUEST_BYTES) return;
    cutOff = true;
    buffer = '';
    logFailure('request', 'request_too_large');
    connection.end(`${JSON.stringify({ id: -1, ok: false, ...ipcError('request_too_large') })}\n`);
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
export async function serveDaemon(
  daemon: ServedApplication,
  options: ServeOptions,
): Promise<ServedDaemon> {
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
