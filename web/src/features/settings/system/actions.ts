import { ApiError, type Api } from '../../../shared/api/api.ts';
import type { SystemView } from '../../../shared/api/types.ts';

/** How often the state is read while the group is open. */
export const SYSTEM_POLL_MS = 3000;
/** How often and for how long the page waits for a restarted, stopped or started part. */
export const RESTART_POLL_MS = 1000;
export const RESTART_WAIT_MS = 30_000;

export type Action = 'webRestart' | 'daemonRestart' | 'daemonStop' | 'daemonStart';

/** Translation keys of an action: its question, its result and its timeout. */
export const TEXT = {
  webRestart: {
    title: 'system.web.restartTitle',
    description: 'system.web.restartDescription',
    confirm: 'system.restart',
    done: 'system.web.restarted',
    notBack: 'system.web.notBack',
  },
  daemonRestart: {
    title: 'system.daemon.restartTitle',
    description: 'system.daemon.restartDescription',
    confirm: 'system.restart',
    done: 'system.daemon.restarted',
    notBack: 'system.daemon.notBack',
  },
  daemonStop: {
    title: 'system.daemon.stopTitle',
    description: 'system.daemon.stopDescription',
    confirm: 'system.daemon.stop',
    done: 'system.daemon.stopped',
    notBack: 'system.daemon.notStopped',
  },
  daemonStart: { done: 'system.daemon.started', notBack: 'system.daemon.notStarted' },
} as const;

/** Whether the system reached the state the action leads to. */
export function reached(action: Action, next: SystemView, pidBefore: number | null): boolean {
  switch (action) {
    case 'webRestart':
      return true;
    case 'daemonRestart':
      return next.daemon.pid !== null && next.daemon.pid !== pidBefore;
    case 'daemonStop':
      return !next.daemon.running;
    case 'daemonStart':
      return next.daemon.running && next.web.servedBy === 'daemon';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends the request of an action. */
export function send(api: Api, action: Action, force: boolean): Promise<void> {
  switch (action) {
    case 'webRestart':
      return api.restartWeb();
    case 'daemonRestart':
      return api.restartDaemon(force);
    case 'daemonStop':
      return api.stopDaemon(force);
    case 'daemonStart':
      return api.startDaemon();
  }
}

/** Whether the daemon refused the action because it is busy, so that a force may follow. */
export function isBusy(action: Action, force: boolean, error: unknown): boolean {
  return (
    (action === 'daemonRestart' || action === 'daemonStop') &&
    !force &&
    error instanceof ApiError &&
    error.code === 'daemon_busy'
  );
}
