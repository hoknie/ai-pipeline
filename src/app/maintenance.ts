import { existsSync } from 'node:fs';

import { databasePath } from '../platform/paths/index.ts';
import { hasRunLeftovers } from '../platform/git/index.ts';
import { Database } from '../platform/sqlite/index.ts';
import { queuedRunIds } from '../feature/queue/services/index.ts';
import { cleanPlanOf, createRunArchive, type RunArchive } from '../feature/runs/services/index.ts';
import type { ProviderState } from '../feature/agents/types/index.ts';
import type { RunState } from '../feature/runs/types/index.ts';
import type {
  ResolvedConfig,
  Runtime as RuntimeName,
  RuntimeSettings,
} from '../feature/swarm-config/types/index.ts';

import { createAgents } from './agents.ts';

/** The runs of the state directory, read without a daemon. */
export interface Maintenance {
  loadRun(runId: string): RunState | undefined;
  /** Finished runs, the latest finished first; none when the database does not exist yet. */
  finishedRuns(): RunState[];
  /** The runs whose return item stands in a queue: removing the task cleans them up. */
  queuedRuns(): Set<string>;
  /** Whether the run still has a worktree, service refs or group branches to clean. */
  hasLeftovers(state: RunState): Promise<boolean>;
  close(): void;
}

interface Opened {
  database: Database;
  archive: RunArchive;
}

/** Opens the state directory for offline tasks such as cleaning; the database opens on first use. */
export function openMaintenance(stateDirectory: string): Maintenance {
  const path = databasePath(stateDirectory);
  let opened: Opened | null = null;
  const open = (): Opened => {
    if (opened) return opened;
    const database = new Database(path);
    opened = { database, archive: createRunArchive(database) };
    return opened;
  };
  return {
    loadRun: (runId) => open().archive.load(runId),
    finishedRuns: () => (opened || existsSync(path) ? open().archive.finishedRuns() : []),
    queuedRuns: () => (opened || existsSync(path) ? queuedRunIds(open().database) : new Set()),
    hasLeftovers: (state) => hasRunLeftovers(cleanPlanOf(state, false)),
    close: () => opened?.database.close(),
  };
}

/** The executable an agent CLI is started with, as the environment and the settings say. */
export function agentExecutable(
  name: RuntimeName,
  environment: NodeJS.ProcessEnv,
  settings: RuntimeSettings,
): string {
  return createAgents(environment).agents.runtimeFor(name, settings).executable;
}

/** The availability of the providers of a configuration, as the daemon would find it. */
export function providerStates(
  config: ResolvedConfig,
  environment: NodeJS.ProcessEnv,
): ProviderState[] {
  return createAgents(environment).providers.status(config);
}
