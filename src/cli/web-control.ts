import type { Command } from 'commander';

import { configPaths, loadWebSettings } from '../config/index.ts';
import {
  IpcError,
  pingDaemon,
  request,
  webStartResultSchema,
  webStatusResultSchema,
  webStopResultSchema,
  type PingResult,
  type Style,
  type WebStatusResult,
} from '../protocol/index.ts';

import { context, daemon, type Context } from './commands.ts';
import { failLine, writeLine, type CliIo } from './io.ts';
import { EXIT_NOT_RUNNING } from './daemon.ts';
import { examples } from './help.ts';
import { openBrowser } from './web/open.ts';
import { webTokenFromEnv } from './web/server.ts';
import { readPanelState } from './web/state.ts';

export interface WebStatusView {
  running: boolean;
  pid: number | null;
  url: string | null;
  host: string | null;
  port: number | null;
  auth: 'token' | 'none' | null;
  /** Whether the daemon runs. */
  daemon: boolean;
  reason: string | null;
}

/** The state `aip web status` reports; `panel` is null when the daemon cannot say. */
export function webStatusView(
  ping: PingResult | null,
  panel: WebStatusResult | null,
): WebStatusView {
  const running = ping !== null && panel !== null && panel.running;
  return {
    running,
    pid: running ? (ping.pid ?? null) : null,
    url: running ? panel.url : null,
    host: running ? panel.host : null,
    port: running ? panel.port : null,
    auth: running ? panel.auth : null,
    daemon: ping !== null,
    reason: running ? null : (panel?.reason ?? null),
  };
}

/** Text of `aip web status`. */
export function formatWebStatus(view: WebStatusView): string {
  if (!view.running) {
    const lines = ['aip web: not running'];
    if (view.reason !== null) lines.push(`reason: ${view.reason}`);
    return lines.join('\n');
  }
  return [
    `aip web: running${view.pid === null ? '' : ` (pid ${view.pid})`}`,
    `url: ${view.url ?? 'unknown'}`,
    `address: ${view.host}:${view.port}`,
    `auth: ${view.auth}`,
  ].join('\n');
}

/** A daemon of an older build does not know the `web_*` methods. */
function unknownMethod(error: unknown): boolean {
  return error instanceof IpcError && /invalid (input|discriminator)/i.test(error.message);
}

const OLD_DAEMON =
  'the running daemon does not control the web panel: restart it with `aip daemon restart`';

/** Reads the panel of the daemon, falling back to `web.json` for a daemon of an older build. */
async function panelOf(ctx: Context, ping: PingResult): Promise<WebStatusResult> {
  try {
    return webStatusResultSchema.parse(await request(ctx.socket, 'web_status', {}));
  } catch (error) {
    if (!unknownMethod(error)) throw error;
    const state = readPanelState(ctx.stateDirectory);
    return {
      running: state !== null && state.pid === ping.pid,
      host: state?.host ?? null,
      port: state?.port ?? null,
      auth: state?.auth ?? null,
      url: state?.url ?? null,
      reason: null,
      stopped: false,
    };
  }
}

/**
 * Starts the web panel of the daemon (`restart` re-reads the web settings). A failure is reported
 * on stderr with exit code 1; the daemon keeps running.
 */
export async function startPanel(
  io: CliIo,
  style: Style,
  options: {
    restart: boolean;
    open: boolean | undefined;
    client?: string;
  },
): Promise<void> {
  const print = (value: string): void => writeLine(io, value);
  const fail = (message: string): void => failLine(io, 'aip web', message);
  const { restart, open } = options;
  const client = options.client ?? (restart ? 'aip web restart' : 'aip web start');
  const settings = loadWebSettings(configPaths(io.cwd, io.env.XDG_CONFIG_HOME, io.env.HOME));
  let token: string | undefined;
  if (settings.auth === 'none') {
    if (io.env.AIP_WEB_TOKEN) io.stderr('aip web: AIP_WEB_TOKEN is ignored: web.auth is none\n');
  } else {
    token = webTokenFromEnv(io.env);
  }
  const ctx = context(io, style);
  await daemon(ctx, client);
  let result: ReturnType<typeof webStartResultSchema.parse>;
  try {
    result = webStartResultSchema.parse(
      await request(ctx.socket, 'web_start', {
        ...(token === undefined ? {} : { token }),
        ...(restart ? { restart: true } : {}),
      }),
    );
  } catch (error) {
    fail(unknownMethod(error) ? OLD_DAEMON : (error as Error).message);
    return;
  }
  const ping = await pingDaemon(ctx.socket);
  const word =
    result.state === 'already_running'
      ? 'already running'
      : result.state === 'restarted'
        ? 'restarted'
        : 'started';
  if (options.client === undefined) print(`aip web: ${word} (pid ${ping?.pid ?? 'unknown'})`);
  const url = result.status.url;
  if (url !== null) {
    print(`aip web: ${url}`);
    if (open) openBrowser(url, io.stderr);
  }
}

export function registerWebControl(web: Command, style: Style, io: CliIo): void {
  const print = (value: string): void => writeLine(io, value);
  const fail = (message: string): void => failLine(io, 'aip web', message);
  web
    .command('start')
    .description('Start the web panel of the daemon (nothing happens if it runs)')
    .option('--open', 'open the dashboard in the default browser')
    .addHelpText('after', examples(['aip web start', 'aip web start --open'], style))
    .action(async (options: { open?: boolean }) =>
      startPanel(io, style, { restart: false, open: options.open }),
    );

  web
    .command('stop')
    .description('Stop the web panel of the daemon; the daemon and its agents keep running')
    .addHelpText('after', examples(['aip web stop'], style))
    .action(async () => {
      const ctx = context(io, style);
      const ping = await pingDaemon(ctx.socket);
      if (ping === null) {
        print('aip web: not running');
        return;
      }
      try {
        const result = webStopResultSchema.parse(await request(ctx.socket, 'web_stop', {}));
        print(
          result.state === 'stopped'
            ? `aip web: stopped (pid ${ping.pid ?? 'unknown'})`
            : 'aip web: not running',
        );
      } catch (error) {
        fail(unknownMethod(error) ? OLD_DAEMON : (error as Error).message);
      }
    });

  web
    .command('restart')
    .description('Stop the web panel and start it again, re-reading the web settings')
    .option('--open', 'open the dashboard in the default browser')
    .addHelpText('after', examples(['aip web restart', 'aip web restart --open'], style))
    .action(async (options: { open?: boolean }) =>
      startPanel(io, style, { restart: true, open: options.open }),
    );

  web
    .command('status')
    .description('Show whether the web panel runs (exit code 3 when it does not)')
    .option('--json', 'print JSON on one line')
    .addHelpText('after', examples(['aip web status', 'aip web status --json'], style))
    .action(async (options: { json?: boolean }) => {
      const ctx = context(io, style);
      const ping = await pingDaemon(ctx.socket);
      const panel = ping === null ? null : await panelOf(ctx, ping);
      const view = webStatusView(ping, panel);
      print(options.json ? JSON.stringify(view) : formatWebStatus(view));
      if (!view.running) io.setExitCode(EXIT_NOT_RUNNING);
    });
}
