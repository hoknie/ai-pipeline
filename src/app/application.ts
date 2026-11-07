import { join } from 'node:path';

import { databasePath, socketPath } from '../platform/paths/index.ts';
import {
  DEFAULT_TIMINGS,
  Daemon,
  Executor,
  FileArtifactStorage,
  FilePatchStorage,
  type DaemonOptions,
  type DaemonTimings,
} from '../daemon/index.ts';
import { Store } from '../store/index.ts';

export type ApplicationOptions = DaemonOptions;

export interface Application {
  daemon: Daemon;
}

/** The one place that creates the store, the storages, the executor and the daemon. */
export function createApplication(options: ApplicationOptions): Application {
  const environment = options.environment ?? process.env;
  const timings: DaemonTimings = { ...DEFAULT_TIMINGS, ...options.timings };
  const daemon = new Daemon(options, {
    store: new Store(databasePath(options.stateDirectory)),
    socket: socketPath(options.stateDirectory),
    environment,
    timings,
    patchStorages: [new FilePatchStorage(join(options.stateDirectory, 'patches'))],
    artifactStorages: [new FileArtifactStorage(join(options.stateDirectory, 'artifacts'))],
    createExecutor: (host) =>
      new Executor({
        host,
        entry: options.entry,
        graceMs: options.graceMs ?? timings.stopGraceMs,
        timings,
      }),
  });
  return { daemon };
}
