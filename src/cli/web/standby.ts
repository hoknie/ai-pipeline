import { configPaths, loadWebSettings } from '../../feature/swarm-config/services/index.ts';
import { lockPath } from '../../platform/paths/index.ts';
import {
  checkDaemon,
  ensureDaemon,
  pingDaemon,
  request,
  webStartResultSchema,
} from '../../protocol/index.ts';

import { latestRepository } from './default-repository.ts';
import { startWebServer, webTokenFromEnv } from './server.ts';
import { previousPanelToken, removePanelState, writePanelState } from './state.ts';

export interface StandbyOptions {
  socket: string;
  stateDirectory: string;
  /** Command that runs `aip` (node and the script); the Start button runs the daemon with it. */
  entry: string[];
  environment: NodeJS.ProcessEnv;
  /** Directory the `aip/` configuration is found from. */
  cwd: string;
  /** Process id written to the panel state. */
  pid: number;
  log: (line: string) => void;
  /** Settles when the stand-in should go away without starting the daemon (a signal). */
  stop: Promise<void>;
  /** Called with the address each time the panel starts listening. */
  onListening?: (url: string) => void;
  /** How often the stand-in looks for a daemon started from elsewhere. */
  pollMs?: number;
  /** How long the daemon gets to take the panel back. */
  handOverMs?: number;
}

/** `handed_over`: the daemon serves the panel now; `stopped`: the stand-in was told to go. */
export type StandbyEnd = 'handed_over' | 'stopped';

type Wake = 'start' | 'daemon' | 'stop';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serves the web panel while the daemon is stopped, at the address and with the token of the
 * daemon's panel, so an open page keeps working. The panel never starts the daemon by itself: the
 * Start button does. Once a daemon answers (started by the button or from elsewhere), the stand-in
 * frees the port and asks the daemon to serve the panel with the same token.
 */
export async function runStandbyPanel(options: StandbyOptions): Promise<StandbyEnd> {
  const env = options.environment;
  const settings = loadWebSettings(configPaths(options.cwd, env.XDG_CONFIG_HOME, env.HOME));
  let token: string | undefined;
  if (settings.auth === 'token') {
    const previous = previousPanelToken(options.stateDirectory);
    token =
      webTokenFromEnv(env) ??
      (previous !== null && TOKEN_PATTERN.test(previous) ? previous : undefined);
  }
  const logPath = `${options.stateDirectory}/daemon.log`;
  let wake: (reason: Wake) => void = () => undefined;
  let stopRequested = false;
  void options.stop.then(() => {
    stopRequested = true;
    wake('stop');
  });

  while (!stopRequested) {
    const woken = new Promise<Wake>((resolve) => {
      wake = resolve;
    });
    const server = await startWebServer({
      socket: options.socket,
      host: settings.host,
      port: settings.port,
      auth: settings.auth,
      ...(token === undefined ? {} : { token }),
      log: options.log,
      // Never starts the daemon: it stays stopped until the Start button.
      ensureDaemon: () => checkDaemon(options.socket),
      defaultRepository: () => latestRepository(options.socket),
      system: {
        servedBy: 'standby',
        startDaemon: async () => wake('start'),
        logPath,
      },
    });
    token = server.token ?? undefined;
    writePanelState(options.stateDirectory, {
      pid: options.pid,
      host: server.host,
      port: server.port,
      auth: settings.auth,
      token: server.token,
      url: server.url,
      standby: true,
    });
    options.onListening?.(server.url);
    const timer = setInterval(() => {
      void pingDaemon(options.socket).then(
        (ping) => {
          if (ping !== null) wake('daemon');
        },
        () => undefined,
      );
    }, options.pollMs ?? 1000);
    if (stopRequested) wake('stop');
    const reason = await woken;
    clearInterval(timer);
    await server.close();
    removePanelState(options.stateDirectory, options.pid);
    if (reason === 'stop') return 'stopped';
    try {
      if (reason === 'start') {
        options.log('aip web: starting the daemon');
        await ensureDaemon(options.socket, options.entry, {
          logPath,
          lockPath: lockPath(options.stateDirectory),
          environment: token === undefined ? env : { ...env, AIP_WEB_TOKEN: token },
        });
      }
      await handOver(options, token);
      options.log('aip web: the daemon serves the panel again');
      return 'handed_over';
    } catch (error) {
      options.log(`aip web: the daemon did not take the panel back: ${(error as Error).message}`);
      // With a daemon up the panel is its business; without one the stand-in comes back.
      if ((await pingDaemon(options.socket).catch(() => null)) !== null) return 'handed_over';
    }
  }
  return 'stopped';
}

/** Asks the daemon to serve the panel with the stand-in's token, until it does. */
async function handOver(options: StandbyOptions, token: string | undefined): Promise<void> {
  const deadline = Date.now() + (options.handOverMs ?? 10_000);
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = webStartResultSchema.parse(
        await request(options.socket, 'web_start', token === undefined ? {} : { token }),
      );
      if (result.status.running) return;
      last = new Error(result.status.reason ?? 'the panel did not start');
    } catch (error) {
      last = error;
    }
    await sleep(200);
  }
  throw last instanceof Error ? last : new Error('the daemon did not answer');
}
