import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

import type { BuildInfo, DaemonCheck, PingResult } from '../../protocol/index.ts';

/** Who serves the panel: the daemon (it can restart the panel) or a standalone `aip web`. */
export type ServedBy = 'daemon' | 'standalone';

export interface SystemView {
  daemon: {
    running: boolean;
    pid: number | null;
    version: string | null;
    build: string | null;
    busy: boolean | null;
    /** The side that runs an older build than the other, when the builds differ. */
    mismatch: 'daemon' | 'client' | null;
  };
  web: {
    running: true;
    pid: number;
    /** Address of the panel without the access token. */
    url: string;
    host: string;
    port: number;
    auth: 'token' | 'none';
    version: string;
    build: string;
    servedBy: ServedBy;
  };
  /** The daemon log, where the restart helper writes; null when the panel does not know it. */
  logPath: string | null;
}

export interface SystemInput {
  ping: PingResult | null;
  check: DaemonCheck | null;
  /** Build of the process that serves the panel. */
  panelBuild: BuildInfo;
  servedBy: ServedBy;
  panel: {
    pid: number;
    host: string;
    port: number;
    auth: 'token' | 'none';
  };
  logPath: string | null;
}

/** Address of the panel with no query: the token never leaves the server in this view. */
export function panelAddress(host: string, port: number): string {
  const shown = host.includes(':') ? `[${host}]` : host;
  return `http://${shown}:${port}/`;
}

/** What `GET /api/system` answers. */
export function systemView(input: SystemInput): SystemView {
  const { ping, check, panelBuild, panel } = input;
  return {
    daemon: {
      running: ping !== null,
      pid: ping?.pid ?? null,
      version: ping?.build?.version ?? null,
      build: ping?.build?.fingerprint ?? null,
      busy: ping === null ? null : (ping.busy ?? null),
      mismatch: check?.mismatch?.outdated ?? null,
    },
    web: {
      running: true,
      pid: panel.pid,
      url: panelAddress(panel.host, panel.port),
      host: panel.host,
      port: panel.port,
      auth: panel.auth,
      version: panelBuild.version,
      build: panelBuild.fingerprint,
      servedBy: input.servedBy,
    },
    logPath: input.logPath,
  };
}

export interface SpawnRestartOptions {
  /** Command that runs `aip`: the node executable and the script. */
  entry: string[];
  stateDirectory: string;
  force: boolean;
  environment: NodeJS.ProcessEnv;
}

/**
 * Runs `aip daemon restart --web [--force]` as a process of its own. It outlives the daemon that
 * starts it and writes to the daemon log, because the daemon is the one that goes away.
 */
export function spawnDaemonRestart(options: SpawnRestartOptions): void {
  const [executable, ...args] = options.entry;
  if (!executable) throw new Error('no command to run aip');
  mkdirSync(options.stateDirectory, { recursive: true, mode: 0o700 });
  const output = openSync(join(options.stateDirectory, 'daemon.log'), 'a');
  try {
    const child = spawn(
      executable,
      [...args, 'daemon', 'restart', '--web', ...(options.force ? ['--force'] : [])],
      {
        detached: true,
        stdio: ['ignore', output, output],
        env: options.environment,
      },
    );
    child.on('error', () => undefined);
    child.unref();
  } finally {
    closeSync(output);
  }
}
