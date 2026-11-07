import { join } from 'node:path';

import { lockPath, socketPath, stateDirectoryFromEnvironment } from '../../platform/paths/index.ts';
import { daemonMismatchMessage, ensureDaemon, request } from '../ipc/client/index.ts';
import type { DaemonCheck, Method, ParamsOf } from '../ipc/contract/index.ts';
import type { Style } from '../format/index.ts';

import { examples as renderExamples } from './help.ts';
import { writeLine, type CliIo } from './io.ts';

export interface Context {
  stateDirectory: string;
  socket: string;
  entry: string[];
  style: Style;
  io: CliIo;
}

export function context(io: CliIo, style: Style): Context {
  const directory = stateDirectoryFromEnvironment(io.env);
  return {
    stateDirectory: directory,
    socket: socketPath(directory),
    entry: io.entry,
    style,
    io,
  };
}

const warned = new Set<string>();

/**
 * Starts the daemon when none runs and replaces an older idle one; a daemon of another build
 * that keeps running is reported on stderr, once per process.
 */
export async function daemon(ctx: Context, client = 'aip'): Promise<DaemonCheck> {
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

export async function call<M extends Method>(
  ctx: Context,
  method: M,
  params: ParamsOf<M>,
): Promise<unknown> {
  await daemon(ctx);
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
