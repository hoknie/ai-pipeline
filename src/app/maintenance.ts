import { existsSync } from 'node:fs';

import { databasePath } from '../platform/paths/index.ts';
import { Database } from '../platform/sqlite/index.ts';
import { FinishedRunRepository, RunRepository } from '../feature/runs/repositories/index.ts';
import type { RunState } from '../feature/runs/types/index.ts';

/** The runs of the state directory, read without a daemon. */
export interface Maintenance {
  loadRun(runId: string): RunState | undefined;
  /** Finished runs, the latest finished first; none when the database does not exist yet. */
  finishedRuns(): RunState[];
  close(): void;
}

interface Opened {
  database: Database;
  runs: RunRepository;
  finished: FinishedRunRepository;
}

/** Opens the state directory for offline tasks such as cleaning; the database opens on first use. */
export function openMaintenance(stateDirectory: string): Maintenance {
  const path = databasePath(stateDirectory);
  let opened: Opened | null = null;
  const open = (): Opened => {
    if (opened) return opened;
    const database = new Database(path);
    const runs = new RunRepository(database);
    opened = { database, runs, finished: new FinishedRunRepository(database, runs) };
    return opened;
  };
  return {
    loadRun: (runId) => open().runs.loadRun(runId) ?? undefined,
    finishedRuns: () => (opened || existsSync(path) ? open().finished.finishedRuns() : []),
    close: () => opened?.database.close(),
  };
}
