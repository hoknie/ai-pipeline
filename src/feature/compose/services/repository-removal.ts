import { resolve } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import { repositoryRoot } from '../../../platform/git/index.ts';
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

/** `repository_remove`: a repository leaves the registry when nothing works in it. */
export class RepositoryRemoval {
  private readonly dependencies: RepositoryRemovalDependencies;

  constructor(dependencies: RepositoryRemovalDependencies) {
    this.dependencies = dependencies;
  }

  async remove(path: string): Promise<void> {
    const { registry, states, queues, observers } = this.dependencies;
    let root: string;
    try {
      root = await repositoryRoot(path);
    } catch {
      root = resolve(path);
    }
    if (!registry.has(root)) throw rejected(`unknown repository ${root}`);
    const unfinished = states
      .all()
      .filter((state) => state.run.repository === root && !isRunFinished(state)).length;
    if (unfinished > 0) throw rejected(`repository has unfinished runs: ${unfinished}`);
    const queue = queues.get(root);
    if (queue && (queue.status === 'running' || queue.items.length > 0)) {
      throw rejected('repository queue is not empty or running');
    }
    observers.forgetRepository(root);
    registry.forget(root);
  }
}
