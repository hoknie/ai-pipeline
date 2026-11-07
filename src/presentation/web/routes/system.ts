import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { currentBuild } from '../../../platform/build/index.ts';
import { pingDaemon } from '../../ipc/client/index.ts';
import { panel } from '../errors.ts';
import { json, parseBody, readJson } from '../http.ts';
import { systemView } from '../panel/system.ts';
import type { RawRoute, RouteKit } from './types.ts';

type SystemAction = 'web_restart' | 'daemon_restart' | 'daemon_stop' | 'daemon_start';

const SYSTEM_ACTIONS: Record<string, SystemAction | undefined> = {
  '/api/system/web/restart': 'web_restart',
  '/api/system/daemon/restart': 'daemon_restart',
  '/api/system/daemon/stop': 'daemon_stop',
  '/api/system/daemon/start': 'daemon_start',
};

const forceBody = z.object({ force: z.boolean().optional() });

/** Runs `action` once the response is on its way: the restart closes this very server. */
function afterResponse(
  kit: RouteKit,
  response: ServerResponse,
  label: string,
  action: () => Promise<void>,
): void {
  response.once('finish', () => {
    setImmediate(() => {
      action().catch((error: unknown) => {
        kit.options.log?.(`aip web: ${label} failed: ${(error as Error).message}`);
      });
    });
  });
}

async function showSystem(kit: RouteKit, response: ServerResponse): Promise<void> {
  const hooks = kit.options.system;
  const ping = await pingDaemon(kit.options.socket).catch(() => null);
  const check = ping === null ? null : await kit.ensureDaemon().catch(() => null);
  json(
    response,
    200,
    systemView({
      ping,
      check,
      panelBuild: currentBuild(),
      servedBy: hooks === undefined ? 'standalone' : (hooks.servedBy ?? 'daemon'),
      panel: {
        pid: process.pid,
        host: kit.host,
        port: kit.port(),
        auth: kit.open ? 'none' : 'token',
      },
      logPath: hooks?.logPath ?? null,
    }),
  );
}

function hookOf(kit: RouteKit, action: SystemAction): (force: boolean) => Promise<void> {
  const hooks = kit.options.system;
  if (hooks === undefined) {
    throw panel(
      'conflict',
      'this panel was started by `aip web`: control the daemon in the terminal',
      'web_standalone',
    );
  }
  const hook =
    action === 'web_restart'
      ? hooks.restartWeb
      : action === 'daemon_restart'
        ? hooks.restartDaemon
        : action === 'daemon_stop'
          ? hooks.stopDaemon
          : hooks.startDaemon;
  if (hook === undefined) {
    if (action === 'daemon_start')
      throw panel('conflict', 'the daemon is already running', 'daemon_running');
    throw panel('conflict', 'the daemon is stopped: start it first', 'daemon_stopped');
  }
  return hook;
}

async function refuseWhileBusy(kit: RouteKit, action: SystemAction): Promise<void> {
  const ping = await pingDaemon(kit.options.socket).catch(() => null);
  if (ping?.busy === true)
    throw panel(
      'conflict',
      `agents are running: ${action === 'daemon_stop' ? 'stop' : 'restart'} anyway to stop them`,
      'daemon_busy',
    );
}

const STATES = { daemon_stop: 'stopping', daemon_start: 'starting' } as const;

async function runAction(
  kit: RouteKit,
  incoming: IncomingMessage,
  response: ServerResponse,
  action: SystemAction,
): Promise<void> {
  const body = parseBody(
    action === 'web_restart' ? z.object({}) : forceBody,
    await readJson(incoming),
  );
  const force = (body as { force?: boolean }).force === true;
  const hook = hookOf(kit, action);
  if ((action === 'daemon_restart' || action === 'daemon_stop') && !force) {
    await refuseWhileBusy(kit, action);
  }
  afterResponse(kit, response, action.replace('_', ' '), () => hook(force));
  json(response, 202, { state: STATES[action as keyof typeof STATES] ?? 'restarting' });
}

/** `/api/system` and the restart and stop actions under `/api/system/`. */
export function systemRoute(kit: RouteKit): RawRoute {
  return {
    pattern: /^\/api\/system(\/.*)?$/,
    async handle({ incoming, response, url, verb }) {
      if (url.pathname === '/api/system') {
        if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
        return showSystem(kit, response);
      }
      const action = SYSTEM_ACTIONS[url.pathname];
      if (action === undefined) throw panel('not_found', 'not found');
      if (verb !== 'POST') throw panel('method_not_allowed', 'method not allowed');
      return runAction(kit, incoming, response, action);
    },
  };
}
