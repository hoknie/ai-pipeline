import type { Command } from 'commander';

import { configPaths, loadWebSettings } from '../../../feature/swarm-config/services/index.ts';
import type { WebSettings } from '../../../feature/swarm-config/types/index.ts';
import type { Style } from '../../format/index.ts';
import { request } from '../../ipc/client/index.ts';
import {
  assertLoopbackHost,
  latestRepository,
  openBrowser,
  readPanelState,
  startWebServer,
  webTokenFromEnv,
  type WebServer,
} from '../../web/index.ts';
import { bind, daemon, type Context } from '../context.ts';
import { usage, type CliIo } from '../io.ts';
import { registerWebControl } from '../web-control.ts';

interface WebOptions {
  port?: string;
  host?: string;
  open?: boolean;
}

interface Target {
  host: string;
  port: number;
  token: string | undefined;
}

/** The address and the token the panel is served with; flags beat the settings. */
function target(options: WebOptions, settings: WebSettings, io: CliIo): Target {
  const host = options.host ?? settings.host;
  const port = options.port === undefined ? settings.port : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw usage('--port must be an integer from 0 to 65535');
  assertLoopbackHost(host);
  if (settings.auth === 'none') {
    if (io.env.AIP_WEB_TOKEN) io.stderr('aip web: AIP_WEB_TOKEN is ignored: web.auth is none\n');
    return { host, port, token: undefined };
  }
  return { host, port, token: webTokenFromEnv(io.env) };
}

/** The link of the panel the daemon serves on that address, once it is up; undefined otherwise. */
async function daemonPanel(
  ctx: Context,
  io: CliIo,
  settings: WebSettings,
  at: Target,
): Promise<string | undefined> {
  const autostart =
    settings.autostart && io.env.AIP_WEB_AUTOSTART !== '0' && io.env.AIP_WEB_AUTOSTART !== 'false';
  if (!autostart || at.host !== settings.host || at.port !== settings.port) return undefined;
  // A panel stopped by `aip web stop` is not coming back: do not wait for it.
  const stopped = await request(ctx.socket, 'web_status', {}).then(
    (result) => (result as { stopped?: boolean }).stopped === true,
    () => false,
  );
  const deadline = Date.now() + (stopped ? 0 : (io.panelWaitMs ?? 5000));
  for (;;) {
    const state = readPanelState(ctx.stateDirectory);
    // A stand-in panel hands the port to the daemon started above: wait for the daemon's.
    if (state !== null && !state.standby && state.host === at.host && state.port === at.port) {
      io.stdout(`aip web: ${state.url}\n`);
      io.stdout(`aip web: served by the aip daemon (pid ${state.pid})\n`);
      return state.url;
    }
    if (Date.now() >= deadline) return undefined;
    await new Promise((done) => setTimeout(done, io.panelPollMs ?? 100));
  }
}

async function startOwnServer(ctx: Context, settings: WebSettings, at: Target): Promise<WebServer> {
  try {
    return await startWebServer({
      socket: ctx.socket,
      stateDirectory: ctx.stateDirectory,
      ensureDaemon: () => daemon(ctx, 'aip web'),
      host: at.host,
      port: at.port,
      auth: settings.auth,
      ...(at.token === undefined ? {} : { token: at.token }),
      // The panel works with the daemon's registry only, never with the launch directory.
      defaultRepository: () => latestRepository(ctx.socket),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw usage(
        `port ${at.host}:${at.port} is already in use, maybe by another aip web: open that panel and choose the repository there, or pass --port <n>`,
      );
    throw error;
  }
}

async function runWeb(options: WebOptions, io: CliIo, style: Style): Promise<void> {
  const { print, context } = bind(io, style);
  const settings = loadWebSettings(configPaths(io.cwd, io.env.XDG_CONFIG_HOME, io.env.HOME));
  const at = target(options, settings, io);
  const ctx = context();
  await daemon(ctx, 'aip web');
  const url = await daemonPanel(ctx, io, settings, at);
  if (url !== undefined) {
    if (options.open) openBrowser(url, io.stderr);
    return;
  }
  const web = await startOwnServer(ctx, settings, at);
  // Before the link: whoever reads it may stop this process at once.
  const stopped = new Promise<void>((resolve) => {
    io.onSignal('SIGINT', resolve);
    io.onSignal('SIGTERM', resolve);
  });
  print(`aip web: ${web.url}`);
  print('Press Ctrl+C to stop.');
  if (options.open) openBrowser(web.url, io.stderr);
  await stopped;
  await web.close();
}

export function registerWeb(program: Command, io: CliIo, style: Style): void {
  const { examples, activeStyle } = bind(io, style);
  const web = program
    .command('web')
    .description(
      'Serve a local web dashboard for runs (bound to 127.0.0.1, protected by a token unless web.auth is none)',
    )
    .option('-p, --port <port>', 'port to listen on (default: web.port, 7341)')
    .option('--host <host>', 'loopback address: 127.0.0.1, localhost or ::1 (default: web.host)')
    .option('--open', 'open the dashboard in the default browser')
    .addHelpText(
      'after',
      '\nThe daemon serves the dashboard itself (web.autostart); then `aip web` prints its link and exits. ' +
        '`aip web start|stop|restart|status` control that panel without stopping the daemon.',
    )
    .addHelpText(
      'after',
      examples(['aip web', 'aip web --port 8080 --open', 'aip web start', 'aip web status']),
    )
    .action((options: WebOptions) => runWeb(options, io, style));
  registerWebControl(web, activeStyle, io);
}
