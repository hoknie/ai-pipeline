import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageRoot } from '../../platform/build/index.ts';
import type { DaemonCheck } from '../ipc/contract/index.ts';

export interface WebOptions {
  socket: string;
  host?: string;
  port?: number;
  token?: string;
  /** `none` serves the panel without a token; the Host and Origin checks stay. */
  auth?: 'token' | 'none';
  /** Directory with the built panel; defaults to dist/web of the package. */
  assets?: string;
  /** Fixed repository of requests without `?repository=`; never the process directory. */
  repository?: string;
  /**
   * The repository of requests without `?repository=` when `repository` is not set; null when
   * there is none yet.
   */
  defaultRepository?: () => Promise<string | null>;
  /**
   * Checks the daemon before every connection to it and, while the daemon is older, every
   * {@link RECHECK_MS}; defaults to comparing the builds without starting or restarting it.
   */
  ensureDaemon?: () => Promise<DaemonCheck>;
  /**
   * Set by the daemon that serves this panel: restarts of the panel and of the daemon. Without it
   * (`aip web` on its own) both restarts answer 409 `web_standalone`.
   */
  system?: SystemHooks;
  /** The state directory of aip; uploads are kept in its `uploads` folder (a temporary one without it). */
  stateDirectory?: string;
  /** Where failures after a response go (the daemon log); dropped by default. */
  log?: (line: string) => void;
}

export interface SystemHooks {
  /** `daemon` by default; `standby` while the daemon is stopped and a stand-in serves the panel. */
  servedBy?: 'daemon' | 'standby';
  restartWeb?(): Promise<void>;
  restartDaemon?(force: boolean): Promise<void>;
  /** Stops the daemon and keeps the panel up in a stand-in process. */
  stopDaemon?(force: boolean): Promise<void>;
  /** Starts the daemon and hands the panel back to it (the stand-in only). */
  startDaemon?(): Promise<void>;
  /** The daemon log, shown in the system view. */
  logPath?: string;
}

/** How often a daemon older than the panel is checked again, so it is replaced once idle. */
export const RECHECK_MS = 30_000;

/** dist/web of the package, both from the sources and the build. */
export const DEFAULT_ASSETS = join(packageRoot(), 'dist', 'web');

export interface WebServer {
  server: Server;
  /** null when the panel runs without a token. */
  token: string | null;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}
