import { configPaths, loadWebSettings } from '../../config/index.ts';
import { latestRepository } from './default-repository.ts';
import { previousPanelToken, removePanelState, writePanelState } from './state.ts';
import { startWebServer, webTokenFromEnv, type WebServer } from './server.ts';

export interface DaemonPanelOptions {
  stateDirectory: string;
  socket: string;
  environment?: NodeJS.ProcessEnv;
  /** Where reasons for not starting go; defaults to stderr (the daemon log). */
  log?: (line: string) => void;
}

export interface DaemonPanel {
  url: string;
  close(): Promise<void>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Starts the web panel inside the daemon process. Never throws: the daemon works without the panel,
 * so every failure is logged and gives null.
 */
export async function startDaemonPanel(options: DaemonPanelOptions): Promise<DaemonPanel | null> {
  const env = options.environment ?? process.env;
  const log = options.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  let address = '';
  try {
    const settings = loadWebSettings(configPaths(process.cwd(), env.XDG_CONFIG_HOME, env.HOME));
    if (!settings.autostart || env.AIP_WEB_AUTOSTART === '0' || env.AIP_WEB_AUTOSTART === 'false')
      return null;
    address = `${settings.host}:${settings.port}`;
    let token: string | undefined;
    if (settings.auth === 'token') {
      const previous = previousPanelToken(options.stateDirectory);
      token =
        webTokenFromEnv(env) ??
        (previous !== null && TOKEN_PATTERN.test(previous) ? previous : undefined);
    }
    const web: WebServer = await startWebServer({
      socket: options.socket,
      host: settings.host,
      port: settings.port,
      auth: settings.auth,
      ...(token === undefined ? {} : { token }),
      defaultRepository: () => latestRepository(options.socket),
    });
    try {
      writePanelState(options.stateDirectory, {
        pid: process.pid,
        host: web.host,
        port: web.port,
        auth: settings.auth,
        token: web.token,
        url: web.url,
      });
    } catch (error) {
      await web.close();
      throw error;
    }
    return {
      url: web.url,
      close: async () => {
        await web.close();
        removePanelState(options.stateDirectory, process.pid);
      },
    };
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `port ${address} is already in use`
        : (error as Error).message;
    log(`aip daemon: web panel not started: ${reason}`);
    return null;
  }
}
