import {
  chmodSync,
  existsSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';

import { ensureDirectory, lockPath as daemonLockPath } from '../config/index.ts';
import { parseRequest, type Response } from '../protocol/index.ts';

import { Daemon, type DaemonOptions } from './daemon.ts';

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

export class AlreadyRunning extends Error {
  constructor(pid: number) {
    super(`already running (pid ${pid})`);
    this.name = 'AlreadyRunning';
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the daemon lock. The file is created exclusively, so of two daemons started at the same
 * moment only one gets it; a lock left by a dead process is removed and taken again.
 */
export function acquireLock(path: string): void {
  // Written in full first, then linked: a reader never sees a lock without its pid.
  const draft = `${path}.${process.pid}`;
  writeFileSync(draft, String(process.pid), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(draft, path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const pid = Number(readFileSync(path, 'utf8').trim());
      if (pid === process.pid) return;
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new AlreadyRunning(pid);
      rmSync(path, { force: true });
    }
  } finally {
    rmSync(draft, { force: true });
  }
  throw new Error(`cannot take the daemon lock ${path}`);
}

export interface RunningDaemon {
  daemon: Daemon;
  close(): Promise<void>;
  closed: Promise<void>;
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  ensureDirectory(options.stateDirectory);
  const lockPath = daemonLockPath(options.stateDirectory);
  acquireLock(lockPath);
  const daemon = new Daemon(options);
  rmSync(daemon.socket, { force: true });
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let closing: Promise<void> | null = null;
  const subscriptions = new Set<Socket>();
  let socketCheck: NodeJS.Timeout | null = null;
  let own: Stats | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (socketCheck) clearInterval(socketCheck);
      for (const connection of subscriptions) connection.destroy();
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
      resolveClosed();
    })();
    return closing;
  };
  const server: Server = createServer((connection) => {
    connection.setEncoding('utf8');
    let buffer = '';
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf('\n');
      while (end !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const parsed = parseRequest(line);
        if ('request' in parsed && parsed.request.method === 'subscribe') {
          const unsubscribe = daemon.subscribe((event) => {
            if (connection.destroyed) return;
            if (connection.writableLength > SUBSCRIBER_BUFFER_LIMIT) {
              connection.destroy();
              return;
            }
            connection.write(`${event}\n`);
          });
          subscriptions.add(connection);
          connection.once('close', () => {
            unsubscribe();
            subscriptions.delete(connection);
          });
          end = buffer.indexOf('\n');
          continue;
        }
        void answer(line).then((response) => {
          if (!connection.destroyed) connection.write(`${JSON.stringify(response)}\n`);
          if (response.ok && (response.result as { stopping?: boolean })?.stopping) void close();
        });
        end = buffer.indexOf('\n');
      }
    });
    connection.on('error', () => undefined);
  });
  const answer = async (line: string): Promise<Response> => {
    const parsed = parseRequest(line);
    if ('error' in parsed) return { id: parsed.id, ok: false, error: parsed.error };
    try {
      return { id: parsed.id, ok: true, result: await daemon.handle(parsed.request) };
    } catch (error) {
      return { id: parsed.id, ok: false, error: (error as Error).message };
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(daemon.socket, () => resolve());
    });
    chmodSync(daemon.socket, 0o600);
    const socketStat = statSync(daemon.socket);
    own = socketStat;
    await daemon.start();
    // Without its socket nobody can reach the daemon; without its lock the next client starts
    // another one. Either is gone when the state directory is removed (the socket may live in the
    // temporary directory, see `socketPath`): the daemon then stops by itself.
    socketCheck = setInterval(() => {
      if (closing) return;
      const lost = !sameFile(daemon.socket, socketStat)
        ? `socket ${daemon.socket}`
        : !ownLock(lockPath)
          ? `lock ${lockPath}`
          : null;
      if (lost === null) return;
      process.stderr.write(`aip daemon: ${lost} is gone; stopping\n`);
      void close();
    }, options.socketCheckMs ?? SOCKET_CHECK_MS);
    socketCheck.unref();
  } catch (error) {
    server.close();
    await daemon.stop().catch(() => undefined);
    rmSync(lockPath, { force: true });
    throw error;
  }
  return { daemon, close, closed };
}
