import { z } from 'zod';

import type { BuildInfo } from '../../../platform/build/index.ts';

/** The state of the network the daemon holds; `proxy` has no login and password. */
export const networkStatusSchema = z.object({
  state: z.enum(['off', 'up', 'down']),
  problem: z.string().nullable(),
  checkedAt: z.number().nullable(),
  since: z.number(),
  proxy: z.string().nullable(),
});

export type NetworkStatusView = z.infer<typeof networkStatusSchema>;

export const panelRequests = [
  z.object({ method: z.literal('network_status'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('ping'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('shutdown'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('shutdown_idle'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('subscribe'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('web_status'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('web_start'),
    params: z
      .object({
        token: z
          .string()
          .regex(/^[A-Za-z0-9_-]{16,128}$/)
          .optional(),
        restart: z.boolean().optional(),
      })
      .default({}),
  }),
  z.object({ method: z.literal('web_stop'), params: z.object({}).default({}) }),
] as const;

export const buildInfoSchema = z.object({
  version: z.string(),
  fingerprint: z.string(),
  builtAt: z.number(),
});

/** Answer to `ping`; a daemon older than the build check answers without `build` and `busy`. */
export const pingResultSchema = z.object({
  pong: z.literal(true),
  pid: z.number().int().optional(),
  build: buildInfoSchema.optional(),
  busy: z.boolean().optional(),
  /** The state of the network; absent in a daemon older than the network check. */
  network: networkStatusSchema.optional(),
});

export type PingResult = z.infer<typeof pingResultSchema>;

/** Answer to `shutdown_idle`: the daemon stops only when no agent runs and nothing merges. */
export const shutdownIdleResultSchema = z.object({ stopping: z.boolean() });

/** Answer to `web_status`: the panel the daemon serves. */
export const webStatusResultSchema = z.object({
  running: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  auth: z.enum(['token', 'none']).nullable(),
  url: z.string().nullable(),
  /** Why the panel is not running, when a start failed or the daemon serves none. */
  reason: z.string().nullable(),
  /** The panel was stopped by `aip web stop` and stays so until the next start. */
  stopped: z.boolean(),
});

export type WebStatusResult = z.infer<typeof webStatusResultSchema>;

export const webStartResultSchema = z.object({
  state: z.enum(['started', 'already_running', 'restarted']),
  status: webStatusResultSchema,
});

export type WebStartResult = z.infer<typeof webStartResultSchema>;

export const webStopResultSchema = z.object({ state: z.enum(['stopped', 'not_running']) });

export type WebStopResult = z.infer<typeof webStopResultSchema>;

/** The web panel the daemon serves; implemented outside the daemon layer and passed in. */
export interface PanelControl {
  status(): WebStatusResult;
  start(options: { token?: string; restart?: boolean }): Promise<WebStartResult>;
  stop(): Promise<WebStopResult>;
}

/**
 * What the client found at the socket. `mismatch` is set when the daemon keeps running a build
 * other than the client's: `daemon` means the daemon is older (it was busy, or too old to stop
 * on request), `client` means this process is older than the daemon.
 */
export interface DaemonCheck {
  started: boolean;
  restarted: boolean;
  mismatch: null | {
    outdated: 'daemon' | 'client';
    pid: number | null;
    daemon: BuildInfo | null;
    client: BuildInfo;
    busy: boolean;
  };
}
