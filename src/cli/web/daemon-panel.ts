import { resolve } from 'node:path';

import type { PanelControl } from '../../daemon/index.ts';
import type { WebStartResult, WebStatusResult, WebStopResult } from '../../protocol/index.ts';
import { configPaths, loadWebSettings } from '../../config/index.ts';
import { latestRepository } from './default-repository.ts';
import { previousPanelToken, removePanelState, writePanelState } from './state.ts';
import { startWebServer, webTokenFromEnv, type WebServer } from './server.ts';
import { spawnDaemonRestart, type SpawnRestartOptions } from './system.ts';

export interface DaemonPanelOptions {
  stateDirectory: string;
  socket: string;
  environment?: NodeJS.ProcessEnv;
  /** Directory the `aip/` configuration is found from; the current directory by default. */
  cwd?: string;
  /** Process id written to the panel state; the one of this process by default. */
  pid?: number;
  /** Where reasons for not starting go (the daemon log); dropped by default. */
  log?: (line: string) => void;
  /** Command that runs `aip` (node and the script); restarting the daemon from the panel needs it. */
  entry?: string[];
  /** Starts the process that restarts or stops the daemon; replaced in tests. */
  spawnRestart?: (options: SpawnRestartOptions) => void;
}

export interface DaemonPanel {
  url: string;
  close(): Promise<void>;
}

export interface DaemonPanelController extends PanelControl {
  /** Starts the panel at daemon start, unless `web.autostart` or `AIP_WEB_AUTOSTART` turn it off. */
  autostart(): Promise<DaemonPanel | null>;
  close(): Promise<void>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function failureReason(error: unknown, address: string): string {
  return (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ? `port ${address} is already in use`
    : (error as Error).message;
}

/**
 * Controls the web panel inside the daemon process. Starts and stops run one after another, so an
 * autostart and a `web_start` that arrive together raise one server. The `web` section is read on
 * every start.
 */
export function createDaemonPanel(options: DaemonPanelOptions): DaemonPanelController {
  const env = options.environment ?? {};
  const cwd = options.cwd ?? resolve('.');
  const pid = options.pid ?? process.pid;
  const log = options.log ?? (() => undefined);
  let web: WebServer | null = null;
  let auth: 'token' | 'none' = 'token';
  let lastToken: string | null = null;
  let reason: string | null = null;
  let stopped = false;
  let chain: Promise<unknown> = Promise.resolve();

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task);
    chain = result.catch(() => undefined);
    return result;
  };

  const status = (): WebStatusResult =>
    web === null
      ? { running: false, host: null, port: null, auth: null, url: null, reason, stopped }
      : {
          running: true,
          host: web.host,
          port: web.port,
          auth,
          url: web.url,
          reason: null,
          stopped: false,
        };

  async function shutdown(): Promise<void> {
    const current = web;
    if (current === null) return;
    web = null;
    await current.close();
    removePanelState(options.stateDirectory, pid);
  }

  /**
   * Runs `aip daemon restart|stop --web` as a process of its own: it outlives this daemon. The old
   * daemon removes web.json on stop, so the helper gets the token through the environment and the
   * browser keeps its access.
   */
  function helper(command: 'restart' | 'stop', force: boolean): void {
    if (options.entry === undefined) throw new Error('the command to run aip is unknown');
    const token = auth === 'token' ? (web?.token ?? lastToken) : null;
    (options.spawnRestart ?? spawnDaemonRestart)({
      entry: options.entry,
      stateDirectory: options.stateDirectory,
      command,
      force,
      environment: token === null ? env : { ...env, AIP_WEB_TOKEN: token },
    });
  }

  /** Raises the server; on failure keeps the reason and throws it as an Error. */
  async function launch(requested: string | undefined): Promise<void> {
    let address = '';
    try {
      const settings = loadWebSettings(configPaths(cwd, env.XDG_CONFIG_HOME, env.HOME));
      address = `${settings.host}:${settings.port}`;
      let token: string | undefined;
      if (settings.auth === 'token') {
        const previous = lastToken ?? previousPanelToken(options.stateDirectory);
        token =
          requested ??
          webTokenFromEnv(env) ??
          (previous !== null && TOKEN_PATTERN.test(previous) ? previous : undefined);
      }
      const server = await startWebServer({
        socket: options.socket,
        host: settings.host,
        port: settings.port,
        auth: settings.auth,
        ...(token === undefined ? {} : { token }),
        log,
        defaultRepository: () => latestRepository(options.socket),
        system: {
          restartWeb: async () => {
            await controller.start({ restart: true });
          },
          restartDaemon: async (force) => helper('restart', force),
          stopDaemon: async (force) => helper('stop', force),
          logPath: `${options.stateDirectory}/daemon.log`,
        },
      });
      try {
        writePanelState(options.stateDirectory, {
          pid,
          host: server.host,
          port: server.port,
          auth: settings.auth,
          token: server.token,
          url: server.url,
        });
      } catch (error) {
        await server.close();
        throw error;
      }
      web = server;
      auth = settings.auth;
      lastToken = server.token;
      reason = null;
      stopped = false;
    } catch (error) {
      reason = failureReason(error, address);
      throw new Error(reason);
    }
  }

  const controller: DaemonPanelController = {
    status,
    start: (params): Promise<WebStartResult> =>
      serial(async () => {
        let state: WebStartResult['state'] = 'started';
        if (web !== null) {
          if (params.restart !== true) return { state: 'already_running', status: status() };
          lastToken = web.token ?? lastToken;
          await shutdown();
          state = 'restarted';
        }
        await launch(params.token);
        return { state, status: status() };
      }),
    stop: (): Promise<WebStopResult> =>
      serial(async () => {
        const running = web !== null;
        await shutdown();
        stopped = true;
        reason = null;
        return { state: running ? 'stopped' : 'not_running' };
      }),
    autostart: () =>
      serial(async () => {
        try {
          const settings = loadWebSettings(configPaths(cwd, env.XDG_CONFIG_HOME, env.HOME));
          if (
            !settings.autostart ||
            env.AIP_WEB_AUTOSTART === '0' ||
            env.AIP_WEB_AUTOSTART === 'false'
          )
            return null;
        } catch (error) {
          reason = (error as Error).message;
          log(`aip daemon: web panel not started: ${reason}`);
          return null;
        }
        if (web === null && !stopped) {
          try {
            await launch(undefined);
          } catch (error) {
            log(`aip daemon: web panel not started: ${(error as Error).message}`);
            return null;
          }
        }
        const current = web as WebServer | null;
        return current === null ? null : { url: current.url, close: () => controller.close() };
      }),
    close: () => serial(shutdown),
  };
  return controller;
}

/**
 * Starts the web panel inside the daemon process once. Never throws: the daemon works without the
 * panel, so every failure is logged and gives null.
 */
export async function startDaemonPanel(options: DaemonPanelOptions): Promise<DaemonPanel | null> {
  return createDaemonPanel(options).autostart();
}
