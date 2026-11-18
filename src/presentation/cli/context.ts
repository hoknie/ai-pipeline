import { join } from 'node:path';

import type { Command } from 'commander';

import { packageVersion } from '../../platform/build/index.ts';
import { lockPath, socketPath, stateDirectoryFromEnvironment } from '../../platform/paths/index.ts';
import {
  daemonMismatchMessage,
  ensureDaemon,
  request,
  type RemoteDaemon,
} from '../ipc/client/index.ts';
import type { DaemonCheck, Method, ParamsOf } from '../ipc/contract/index.ts';
import type { Style } from '../format/index.ts';

import { remoteOf } from './commands/server/profile.ts';
import { mapRepository } from './commands/server/repository.ts';
import { examples as renderExamples } from './help.ts';
import { usage, writeLine, type CliIo } from './io.ts';

export interface Context {
  stateDirectory: string;
  socket: string;
  entry: string[];
  style: Style;
  io: CliIo;
  /** The server of the profile or of `AIP_SERVER`: the commands work with it, not with a local daemon. */
  remote: RemoteDaemon | null;
}

export function context(io: CliIo, style: Style): Context {
  const directory = stateDirectoryFromEnvironment(io.env);
  return {
    stateDirectory: directory,
    socket: socketPath(directory),
    entry: io.entry,
    style,
    io,
    remote: remoteOf(io.env),
  };
}

/**
 * A command of the local daemon makes no sense while the commands work with a server: it ends
 * with a hint (`aip logout`, or unset `AIP_SERVER`) before it does anything.
 */
export function refuseWithServer(command: Command, io: CliIo): void {
  command.hook('preAction', () => {
    if (remoteOf(io.env) === null) return;
    throw usage(
      'this command works with the local daemon, but the commands use a server: run `aip logout` (and unset AIP_SERVER) first',
    );
  });
}

const warned = new Set<string>();

/**
 * Starts the daemon when none runs and replaces an older idle one; a daemon of another build
 * that keeps running is reported on stderr, once per process.
 */
export async function daemon(ctx: Context, client = 'aip'): Promise<DaemonCheck> {
  if (ctx.remote !== null) return checkServer(ctx, ctx.remote);
  const check = await ensureDaemon(ctx.socket, ctx.entry, {
    logPath: join(ctx.stateDirectory, 'daemon.log'),
    environment: ctx.io.env,
    lockPath: lockPath(ctx.stateDirectory),
  });
  const message = daemonMismatchMessage(check, client);
  if (message && !warned.has(message)) {
    warned.add(message);
    ctx.io.stderr(`aip: warning: ${message}\n`);
  }
  return check;
}

/** The server answers and runs the same version as this client; a different one is reported once. */
async function checkServer(ctx: Context, remote: RemoteDaemon): Promise<DaemonCheck> {
  const ping = (await request(remote, 'ping', {})) as { build?: { version?: string } };
  const server = ping.build?.version;
  const message =
    server !== undefined && server !== packageVersion()
      ? `the server runs aip ${server}, this client ${packageVersion()}: update the older one`
      : null;
  if (message && !warned.has(message)) {
    warned.add(message);
    ctx.io.stderr(`aip: warning: ${message}\n`);
  }
  return { started: false, restarted: false, mismatch: null };
}

export async function call<M extends Method>(
  ctx: Context,
  method: M,
  params: ParamsOf<M>,
): Promise<unknown> {
  await daemon(ctx);
  if (ctx.remote !== null) return request(ctx.remote, method, await mapRepository(ctx, params));
  return request(ctx.socket, method, params);
}

/** The helpers of the commands, bound to the streams and the style of one call. */
export function bind(io: CliIo, style: Style) {
  const print = (value: string): void => writeLine(io, value);
  return {
    print,
    output: (json: boolean | undefined, text: string, data: unknown): void =>
      print(json ? JSON.stringify(data, null, 2) : text),
    examples: (lines: string[]): string => renderExamples(lines, style),
    context: (): Context => context(io, style),
    activeStyle: style,
  };
}
