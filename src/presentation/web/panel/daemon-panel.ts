import type { WebSettings } from '../../../feature/swarm-config/types/index.ts';
import { unavailable } from '../../../platform/errors/index.ts';
import type {
  PanelControl,
  WebStartResult,
  WebStatusResult,
  WebStopResult,
} from '../../ipc/contract/index.ts';
import { startWebServer, webTokenFromEnv, type WebServer } from '../server.ts';
import { latestRepository } from './default-repository.ts';
import { previousPanelToken, removePanelState, writePanelState } from './state.ts';
import { spawnDaemonRestart, type SpawnRestartOptions } from './system.ts';

export interface DaemonPanelOptions {
  stateDirectory: string;
  socket: string;
  environment?: NodeJS.ProcessEnv;
  /** Reads the `web` section of the settings; called on every start. */
  readSettings: () => WebSettings;
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

const daemonPanelError = (message: string) => unavailable('web.daemon', message);

function failureReason(error: unknown, address: string): string {
  return (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ? `port ${address} is already in use`
    : (error as Error).message;
}

/** What a daemon panel remembers between starts and stops. */
interface PanelState {
  web: WebServer | null;
  auth: 'token' | 'none';
  lastToken: string | null;
  reason: string | null;
  stopped: boolean;
}

interface PanelContext {
  options: DaemonPanelOptions;
  env: NodeJS.ProcessEnv;
  pid: number;
  log: (line: string) => void;
  state: PanelState;
  controller: () => DaemonPanelController;
}

function panelStatus(state: PanelState): WebStatusResult {
  const { web } = state;
  if (web === null) {
    return {
      running: false,
      host: null,
      port: null,
      auth: null,
      url: null,
      reason: state.reason,
      stopped: state.stopped,
    };
  }
  return {
    running: true,
    host: web.host,
    port: web.port,
    auth: state.auth,
    url: web.url,
    reason: null,
    stopped: false,
  };
}

async function shutdown({ options, pid, state }: PanelContext): Promise<void> {
  const current = state.web;
  if (current === null) return;
  state.web = null;
  await current.close();
  removePanelState(options.stateDirectory, pid);
}

/**
 * Runs `aip daemon restart|stop --web` as a process of its own: it outlives this daemon. The old
 * daemon removes web.json on stop, so the helper gets the token through the environment and the
 * browser keeps its access.
 */
function runHelper(ctx: PanelContext, command: 'restart' | 'stop', force: boolean): void {
  const { options, env, state } = ctx;
  if (options.entry === undefined) throw daemonPanelError('the command to run aip is unknown');
  const token = state.auth === 'token' ? (state.web?.token ?? state.lastToken) : null;
  (options.spawnRestart ?? spawnDaemonRestart)({
    entry: options.entry,
    stateDirectory: options.stateDirectory,
    command,
    force,
    environment: token === null ? env : { ...env, AIP_WEB_TOKEN: token },
  });
}

/** The token a new server starts with: requested, from the environment, or the previous one. */
function chooseToken(ctx: PanelContext, requested: string | undefined): string | undefined {
  const previous = ctx.state.lastToken ?? previousPanelToken(ctx.options.stateDirectory);
  return (
    requested ??
    webTokenFromEnv(ctx.env) ??
    (previous !== null && TOKEN_PATTERN.test(previous) ? previous : undefined)
  );
}

async function startServer(
  ctx: PanelContext,
  settings: WebSettings,
  token: string | undefined,
): Promise<WebServer> {
  const { options } = ctx;
  return startWebServer({
    socket: options.socket,
    stateDirectory: options.stateDirectory,
    host: settings.host,
    port: settings.port,
    auth: settings.auth,
    ...(token === undefined ? {} : { token }),
    log: ctx.log,
    defaultRepository: () => latestRepository(options.socket),
    system: {
      restartWeb: async () => {
        await ctx.controller().start({ restart: true });
      },
      restartDaemon: async (force) => runHelper(ctx, 'restart', force),
      stopDaemon: async (force) => runHelper(ctx, 'stop', force),
      logPath: `${options.stateDirectory}/daemon.log`,
    },
  });
}

/** Raises the server; on failure keeps the reason and throws it as an Error. */
async function launch(ctx: PanelContext, requested: string | undefined): Promise<void> {
  const { options, state } = ctx;
  let address = '';
  try {
    const settings = options.readSettings();
    address = `${settings.host}:${settings.port}`;
    const token = settings.auth === 'token' ? chooseToken(ctx, requested) : undefined;
    const server = await startServer(ctx, settings, token);
    try {
      writePanelState(options.stateDirectory, {
        pid: ctx.pid,
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
    state.web = server;
    state.auth = settings.auth;
    state.lastToken = server.token;
    state.reason = null;
    state.stopped = false;
  } catch (error) {
    state.reason = failureReason(error, address);
    throw daemonPanelError(state.reason);
  }
}

async function startPanel(
  ctx: PanelContext,
  params: { token?: string; restart?: boolean },
): Promise<WebStartResult> {
  const { state } = ctx;
  let result: WebStartResult['state'] = 'started';
  if (state.web !== null) {
    if (params.restart !== true) return { state: 'already_running', status: panelStatus(state) };
    state.lastToken = state.web.token ?? state.lastToken;
    await shutdown(ctx);
    result = 'restarted';
  }
  await launch(ctx, params.token);
  return { state: result, status: panelStatus(state) };
}

async function stopPanel(ctx: PanelContext): Promise<WebStopResult> {
  const running = ctx.state.web !== null;
  await shutdown(ctx);
  ctx.state.stopped = true;
  ctx.state.reason = null;
  return { state: running ? 'stopped' : 'not_running' };
}

/** Whether `web.autostart` and `AIP_WEB_AUTOSTART` allow the panel to start with the daemon. */
function autostartAllowed(ctx: PanelContext): boolean {
  try {
    const settings = ctx.options.readSettings();
    const flag = ctx.env.AIP_WEB_AUTOSTART;
    return settings.autostart && flag !== '0' && flag !== 'false';
  } catch (error) {
    ctx.state.reason = (error as Error).message;
    ctx.log(`aip daemon: web panel not started: ${ctx.state.reason}`);
    return false;
  }
}

async function autostartPanel(ctx: PanelContext): Promise<DaemonPanel | null> {
  if (!autostartAllowed(ctx)) return null;
  if (ctx.state.web === null && !ctx.state.stopped) {
    try {
      await launch(ctx, undefined);
    } catch (error) {
      ctx.log(`aip daemon: web panel not started: ${(error as Error).message}`);
      return null;
    }
  }
  const current = ctx.state.web;
  return current === null ? null : { url: current.url, close: () => ctx.controller().close() };
}

/**
 * Controls the web panel inside the daemon process. Starts and stops run one after another, so an
 * autostart and a `web_start` that arrive together raise one server. The `web` section is read on
 * every start.
 */
export function createDaemonPanel(options: DaemonPanelOptions): DaemonPanelController {
  const ctx: PanelContext = {
    options,
    env: options.environment ?? {},
    pid: options.pid ?? process.pid,
    log: options.log ?? (() => undefined),
    state: { web: null, auth: 'token', lastToken: null, reason: null, stopped: false },
    controller: () => controller,
  };
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task);
    chain = result.catch(() => undefined);
    return result;
  };
  const controller: DaemonPanelController = {
    status: () => panelStatus(ctx.state),
    start: (params) => serial(() => startPanel(ctx, params)),
    stop: () => serial(() => stopPanel(ctx)),
    autostart: () => serial(() => autostartPanel(ctx)),
    close: () => serial(() => shutdown(ctx)),
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
