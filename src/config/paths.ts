import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function stateDirectoryFromEnvironment(environment = process.env): string {
  return stateDirectory(environment.XDG_STATE_HOME, environment.HOME);
}

export function stateDirectory(xdgStateHome: string | undefined, home: string | undefined): string {
  const base =
    xdgStateHome && isAbsolute(xdgStateHome) ? xdgStateHome : join(home ?? '.', '.local', 'state');
  return join(base, 'aip');
}

export function ensureDirectory(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

export function databasePath(directory: string): string {
  return join(directory, 'aip.db');
}

export const SOCKET_PATH_LIMIT = 100;

/** Lock file of the daemon: holds the pid of the daemon that owns the state directory. */
export function lockPath(directory: string): string {
  return join(directory, 'aip.pid');
}

export function socketPath(directory: string, temporary: string = tmpdir()): string {
  const preferred = join(directory, 'aip.sock');
  if (Buffer.byteLength(preferred) <= SOCKET_PATH_LIMIT) return preferred;
  const key = createHash('sha256').update(directory).digest('hex').slice(0, 16);
  return join(temporary, `aip-${key}.sock`);
}
