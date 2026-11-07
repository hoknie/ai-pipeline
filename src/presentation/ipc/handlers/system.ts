import { rejected } from '../../../platform/errors/index.ts';
import type { PingResult } from '../contract/index.ts';

import type { HandlerTable } from './types.ts';

const NO_PANEL = 'this daemon serves no web panel';

/** The daemon itself: liveness, stopping, subscriptions and the panel inside it. */
export const systemHandlers = {
  ping: async (_params, { services, build }) =>
    ({
      pong: true,
      pid: process.pid,
      build,
      busy: services.runs.engine.busy(),
    }) satisfies PingResult,
  shutdown: async () => ({ stopping: true }),
  // After the work already queued, so the check and the stop are one step.
  shutdown_idle: (_params, { services }) => {
    const { engine } = services.runs;
    return engine.serial(() => {
      if (engine.stopping || engine.busy()) return Promise.resolve({ stopping: false });
      // Stopping now keeps the scheduler from starting an agent before the daemon closes.
      engine.halt();
      return Promise.resolve({ stopping: true });
    });
  },
  subscribe: () => Promise.reject(rejected('subscribe is served on its own connection')),
  web_status: async (_params, { panel }) =>
    panel?.status() ?? {
      running: false,
      host: null,
      port: null,
      auth: null,
      url: null,
      reason: NO_PANEL,
      stopped: false,
    },
  web_start: (params, { panel }) =>
    panel ? panel.start(params) : Promise.reject(rejected(NO_PANEL)),
  web_stop: (_params, { panel }) => (panel ? panel.stop() : Promise.reject(rejected(NO_PANEL))),
  processes: (_params, { services }) => services.processes.list(),
  process_kill: (params, { services }) => services.processes.kill(params.pid),
} satisfies Partial<HandlerTable>;
