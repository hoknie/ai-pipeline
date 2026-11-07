import { join } from 'node:path';

import { databasePath, socketPath } from '../platform/paths/index.ts';
import { Database } from '../platform/sqlite/index.ts';
import {
  DEFAULT_TIMINGS,
  Daemon,
  Executor,
  type DaemonOptions,
  type DaemonRepositories,
  type DaemonTimings,
} from '../daemon/index.ts';
import {
  FileArtifactStorage,
  ArtifactRepository,
} from '../feature/artifacts/repositories/index.ts';
import { FilePatchStorage, PatchRepository } from '../feature/delivery/repositories/index.ts';
import { ObserverRepository } from '../feature/observers/repositories/index.ts';
import { QueueRepository } from '../feature/queue/repositories/index.ts';
import { KnownRepositories } from '../feature/repos/repositories/index.ts';
import { FinishedRunRepository, RunRepository } from '../feature/runs/repositories/index.ts';
import { TagRepository } from '../feature/tags/repositories/index.ts';

export type ApplicationOptions = DaemonOptions;

export interface Application {
  daemon: Daemon;
}

/** The database and the repositories of the features on it. */
function createRepositories(database: Database): DaemonRepositories {
  const runs = new RunRepository(database);
  return {
    runs,
    finished: new FinishedRunRepository(database, runs),
    queues: new QueueRepository(database),
    known: new KnownRepositories(database),
    tags: new TagRepository(database),
    patches: new PatchRepository(database),
    artifacts: new ArtifactRepository(database),
    observers: new ObserverRepository(database),
  };
}

/** The one place that creates the database, the storages, the executor and the daemon. */
export function createApplication(options: ApplicationOptions): Application {
  const environment = options.environment ?? process.env;
  const timings: DaemonTimings = { ...DEFAULT_TIMINGS, ...options.timings };
  const database = new Database(databasePath(options.stateDirectory));
  const daemon = new Daemon(options, {
    database,
    repositories: createRepositories(database),
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
