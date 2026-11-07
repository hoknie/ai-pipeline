import {
  parseObserversView,
  type ObserverSettings,
  type ObserversResult,
  type ObserversView,
} from './observerTypes.ts';
import type { BackgroundProcessesView, RepositoryView, SystemView } from './types.ts';
import { ApiError, call, enc, json, post, withRepository } from './http.ts';

/** The view in an answer; an answer that is not one is a failure. */
function viewOf(body: unknown): ObserversView {
  const view = parseObserversView(body);
  if (view === null) throw new ApiError(502, 'Malformed answer of /api/observers');
  return view;
}

/** 200 is the saved view, 422 the errors of fields; anything else is a failure. */
async function saveObservers(settings: ObserverSettings): Promise<ObserversResult> {
  const response = await fetch('/api/observers', {
    credentials: 'same-origin',
    ...json('PUT', settings),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 200) return { ok: true, view: viewOf(body) };
  if (response.status === 422)
    return { ok: false, errors: (body.errors ?? []) as { path: string; message: string }[] };
  throw new ApiError(response.status, String(body.error ?? response.statusText));
}

export interface SystemApi {
  /** The daemon's list of repositories with counters. */
  repositories(): Promise<RepositoryView[]>;
  /** Adds the git repository of a path to the daemon's list; returns the new list. */
  addRepository(path: string): Promise<RepositoryView[]>;
  /** Removes a repository from the list; the daemon refuses while it has work. */
  removeRepository(path: string): Promise<RepositoryView[]>;
  /** Processes started by agents of the daemon (all repositories). */
  processes(): Promise<BackgroundProcessesView>;
  /** Terminates a background process and its children; the daemon refuses any other PID. */
  killProcess(pid: number): Promise<unknown>;
  /** State of the daemon and of the panel itself. */
  system(): Promise<SystemView>;
  /** Restarts the panel; the answer comes before it goes down. */
  restartWeb(): Promise<void>;
  /** Restarts the daemon; refused with code `daemon_busy` while agents run, unless `force`. */
  restartDaemon(force: boolean): Promise<void>;
  /**
   * Stops the daemon; the panel stays up in a stand-in process. Refused with code `daemon_busy`
   * while agents run, unless `force`.
   */
  stopDaemon(force: boolean): Promise<void>;
  /** Starts the daemon from the stand-in panel; the daemon takes the panel back. */
  startDaemon(): Promise<void>;
  /** The settings of the observers and their running repairs. */
  observers(): Promise<ObserversView>;
  /** Saves the settings of the observers; wrong fields come back as a result, not an error. */
  setObservers(settings: ObserverSettings): Promise<ObserversResult>;
  /** Forbids (`enabled: false`) or gives back the observer in one run. */
  setRunObserver(run: string, repository: string, enabled: boolean): Promise<unknown>;
}

export function systemApi(): SystemApi {
  return {
    repositories: () => call('/api/repositories'),
    addRepository: (path) => post('/api/repositories', { path }),
    removeRepository: (path) =>
      call(`/api/repositories?repository=${enc(path)}`, { method: 'DELETE' }),
    processes: () => call('/api/processes'),
    killProcess: (pid) => post(`/api/processes/${pid}/kill`),
    system: () => call('/api/system'),
    restartWeb: async () => void (await post('/api/system/web/restart')),
    restartDaemon: async (force) =>
      void (await post('/api/system/daemon/restart', force ? { force: true } : {})),
    stopDaemon: async (force) =>
      void (await post('/api/system/daemon/stop', force ? { force: true } : {})),
    startDaemon: async () => void (await post('/api/system/daemon/start')),
    observers: async () => viewOf(await call<unknown>('/api/observers')),
    setObservers: saveObservers,
    setRunObserver: (run, runRepository, enabled) =>
      post(withRepository(`/api/runs/${enc(run)}/observer`, runRepository), { enabled }),
  };
}
