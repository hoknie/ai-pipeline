import { rejected } from '../../../platform/errors/index.ts';
import type { ObserverService } from '../../observers/services/index.ts';
import type { QueueStore } from '../../queue/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunStates } from '../../runs/services/index.ts';
import { isRunFinished } from '../../runs/types/index.ts';

export interface RepositoryRemovalDependencies {
  registry: RegistryService;
  states: RunStates;
  queues: QueueStore;
  observers: ObserverService;
}

/** Refuses a project with an unfinished run: its worktrees and refs belong to the project's root. */
export function checkNoUnfinishedRuns(root: string, states: RunStates): void {
  const unfinished = states
    .all()
    .filter((state) => state.run.repository === root && !isRunFinished(state))
    .map((state) => state.run.id);
  if (unfinished.length > 0) {
    throw rejected(
      `repository has unfinished runs: ${unfinished.length} (${unfinished.join(', ')})`,
    );
  }
}

/**
 * Refuses a project that still works: an unfinished run, or tasks in its queue. A queue left
 * running without tasks does not hold the project.
 */
export function checkIdle(root: string, states: RunStates, queues: QueueStore): void {
  checkNoUnfinishedRuns(root, states);
  const queue = queues.get(root);
  if (queue && queue.items.length > 0) {
    throw rejected(`repository queue holds tasks: ${queue.items.length}`);
  }
}

/** `repository_remove`: a repository leaves the registry when nothing works in it. */
export class RepositoryRemoval {
  private readonly dependencies: RepositoryRemovalDependencies;

  constructor(dependencies: RepositoryRemovalDependencies) {
    this.dependencies = dependencies;
  }

  async remove(path: string): Promise<void> {
    const { registry, states, queues, observers } = this.dependencies;
    const root = await registry.resolve(path);
    checkIdle(root, states, queues);
    observers.forgetRepository(root);
    registry.forget(root);
  }
}
