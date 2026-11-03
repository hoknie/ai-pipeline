import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { currentBuild, type BuildInfo } from './build.ts';
import { DaemonUnavailable, request } from './client.ts';
import { pingResultSchema, shutdownIdleResultSchema, type PingResult } from './messages.ts';

/**
 * What the client found at the socket. `mismatch` is set when the daemon keeps running a build
 * other than the client's: `daemon` means the daemon is older (it was busy, or too old to stop
 * on request), `client` means this process is older than the daemon.
 */
export interface DaemonCheck {
  started: boolean;
  restarted: boolean;
  mismatch: null | {
    outdated: 'daemon' | 'client';
    pid: number | null;
    daemon: BuildInfo | null;
    client: BuildInfo;
    busy: boolean;
  };
}

export interface EnsureOptions {
  timeoutMs?: number;
  logPath?: string;
  environment?: NodeJS.ProcessEnv;
  /** Lock file of the daemon (`aip.pid`); lets a restart wait until the old daemon is gone. */
  lockPath?: string;
  /** Build of the client; defaults to the build of this process. */
  build?: BuildInfo;
}

/**
 * Makes sure a daemon of the client's build listens at the socket: starts one when none answers,
 * and replaces an older idle daemon. A busy or newer daemon is left running and reported.
 */
export async function ensureDaemon(
  socket: string,
  command: string[],
  options: EnsureOptions = {},
): Promise<DaemonCheck> {
  const client = options.build ?? currentBuild();
  const ping = await pingDaemon(socket);
  if (ping === null) {
    await spawnDaemon(socket, command, options);
    return { started: true, restarted: false, mismatch: null };
  }
  const mismatch = compare(ping, client);
  if (!mismatch) return { started: false, restarted: false, mismatch: null };
  // Only a daemon that knows the build check is asked to stop: an older one stops on any
  // shutdown, with its agents.
  if (mismatch.outdated === 'client' || !ping.build)
    return { started: false, restarted: false, mismatch };
  const stopped = await request(socket, 'shutdown_idle', {}, 5000).then(
    (result) => shutdownIdleResultSchema.safeParse(result).data?.stopping ?? false,
    () => false,
  );
  if (!stopped) return { started: false, restarted: false, mismatch: { ...mismatch, busy: true } };
  await waitGone(socket, ping.pid ?? null, options);
  await spawnDaemon(socket, command, options);
  return { started: true, restarted: true, mismatch: null };
}

/** Compares the daemon with the client without starting or stopping anything. */
export async function checkDaemon(socket: string, build?: BuildInfo): Promise<DaemonCheck> {
  const ping = await pingDaemon(socket);
  return {
    started: false,
    restarted: false,
    mismatch: ping === null ? null : compare(ping, build ?? currentBuild()),
  };
}

function compare(ping: PingResult, client: BuildInfo): DaemonCheck['mismatch'] {
  if (ping.build?.fingerprint === client.fingerprint) return null;
  return {
    // A daemon too old to report its build is older than any client that checks it.
    outdated: ping.build && ping.build.builtAt >= client.builtAt ? 'client' : 'daemon',
    pid: ping.pid ?? null,
    daemon: ping.build ?? null,
    client,
    busy: ping.busy ?? false,
  };
}

/** One line for the user about a daemon of another build, or null when the builds match. */
export function daemonMismatchMessage(check: DaemonCheck, client: string): string | null {
  const mismatch = check.mismatch;
  if (!mismatch) return null;
  const pid = mismatch.pid === null ? '' : ` (pid ${mismatch.pid})`;
  const daemon = mismatch.daemon
    ? `${mismatch.daemon.version}, build ${mismatch.daemon.fingerprint}`
    : 'a build without the version check';
  const own = `${mismatch.client.version}, build ${mismatch.client.fingerprint}`;
  if (mismatch.outdated === 'client') {
    return `the aip daemon${pid} runs a newer build (${daemon}) than this ${client} (${own}); restart ${client}`;
  }
  const restart = '`aip daemon restart --force`';
  const older = `the aip daemon${pid} runs an older build (${daemon}) than this ${client} (${own})`;
  if (!mismatch.daemon)
    return `${older}; it cannot be restarted automatically: run ${restart} (running agents are stopped)`;
  return `${older}; the next aip command restarts it once its agents finish, or run ${restart} now (running agents are stopped)`;
}

export type StopResult =
  | { state: 'not_running' }
  | { state: 'busy'; pid: number | null }
  | { state: 'stopped'; pid: number | null };

export interface StopOptions {
  /** Stop a busy daemon too, together with its agents. */
  force?: boolean;
  /** Lock file of the daemon (`aip.pid`); the call returns once the daemon released it. */
  lockPath?: string;
}

/**
 * Stops the daemon at the socket and waits until it is gone. Without `force` only an idle
 * daemon stops (a daemon too old to know `shutdown_idle` counts as busy).
 */
export async function stopDaemon(socket: string, options: StopOptions = {}): Promise<StopResult> {
  const ping = await pingDaemon(socket);
  if (ping === null) return { state: 'not_running' };
  const pid = ping.pid ?? null;
  if (options.force) {
    await request(socket, 'shutdown', {}, 5000).catch(() => undefined);
  } else {
    const stopping = ping.build
      ? await request(socket, 'shutdown_idle', {}, 5000).then(
          (result) => shutdownIdleResultSchema.safeParse(result).data?.stopping ?? false,
          () => false,
        )
      : false;
    if (!stopping) return { state: 'busy', pid };
  }
  await waitGone(socket, pid, options);
  return { state: 'stopped', pid };
}

/** The answer of the daemon to `ping`, or null when no daemon listens at the socket. */
export async function pingDaemon(socket: string): Promise<PingResult | null> {
  try {
    const result = pingResultSchema.safeParse(await request(socket, 'ping', {}, 2000));
    return result.success ? result.data : { pong: true };
  } catch (error) {
    if (error instanceof DaemonUnavailable) return null;
    throw error;
  }
}

export async function spawnDaemon(
  socket: string,
  command: string[],
  options: EnsureOptions,
): Promise<void> {
  const [executable, ...args] = command;
  if (!executable) throw new Error('no command to start the aip daemon');
  let output: number | 'ignore' = 'ignore';
  if (options.logPath) {
    mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
    output = openSync(options.logPath, 'a');
  }
  const child = spawn(executable, [...args, 'daemon'], {
    detached: true,
    stdio: ['ignore', output, output],
    env: options.environment ?? process.env,
  });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if ((await pingDaemon(socket)) !== null) return;
  }
  throw new Error(
    `aip daemon did not start within ${options.timeoutMs ?? 5000} ms${options.logPath ? `; see ${options.logPath}` : ''}`,
  );
}

/**
 * Waits until the stopped daemon has released its lock (or exited): a new daemon started before
 * that refuses to run, and the old one would remove its socket on the way out.
 */
async function waitGone(
  socket: string,
  pid: number | null,
  options: { lockPath?: string },
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // A daemon that is shutting down may stop answering before it exits.
    const unreachable = (await pingDaemon(socket).catch(() => undefined)) === null;
    if (unreachable && (pid === null || !holdsLock(pid, options.lockPath))) return;
    await sleep(POLL_MS);
  }
  throw new Error(`the old aip daemon${pid === null ? '' : ` (pid ${pid})`} did not stop in time`);
}

function holdsLock(pid: number, lockPath: string | undefined): boolean {
  if (!alive(pid)) return false;
  if (!lockPath) return true;
  try {
    return readFileSync(lockPath, 'utf8').trim() === String(pid);
  } catch {
    return false;
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

/** How often the client checks a daemon it starts or stops: the socket is cheap to ping. */
const POLL_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
