import { existsSync } from 'node:fs';

import { databasePath } from '../platform/paths/index.ts';
import type { RunState } from '../feature/runs/types/index.ts';
import { Store } from '../store/index.ts';

/** The runs of the state directory, read without a daemon. */
export interface Maintenance {
  loadRun(runId: string): RunState | undefined;
  /** Finished runs, the latest finished first; none when the database does not exist yet. */
  finishedRuns(): RunState[];
  close(): void;
}

/** Opens the state directory for offline tasks such as cleaning; the database opens on first use. */
export function openMaintenance(stateDirectory: string): Maintenance {
  const path = databasePath(stateDirectory);
  let store: Store | null = null;
  const open = (): Store => (store ??= new Store(path));
  return {
    loadRun: (runId) => open().loadRun(runId) ?? undefined,
    finishedRuns: () => (store || existsSync(path) ? open().finishedRuns() : []),
    close: () => store?.close(),
  };
}
