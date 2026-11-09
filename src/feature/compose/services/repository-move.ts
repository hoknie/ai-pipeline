import { rejected } from '../../../platform/errors/index.ts';
import { repositoryRoot } from '../../../platform/git/index.ts';
import { expandHome } from '../../../platform/paths/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { ObserverService } from '../../observers/services/index.ts';
import type { QueueStore } from '../../queue/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunStates } from '../../runs/services/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';

import { checkNoUnfinishedRuns } from './repository-removal.ts';

export interface RepositoryMoveDependencies {
  database: Database;
  registry: RegistryService;
  states: RunStates;
  queues: QueueStore;
  tags: TagCatalogService;
  observers: ObserverService;
}

/** `repository_move`: a project, its runs, queue with its tasks, tags and observers move to another root. */
export class RepositoryMove {
  private readonly dependencies: RepositoryMoveDependencies;

  constructor(dependencies: RepositoryMoveDependencies) {
    this.dependencies = dependencies;
  }

  async move(reference: string, path: string): Promise<string> {
    const { database, registry, states, queues, tags, observers } = this.dependencies;
    const from = await registry.resolve(reference);
    const to = await repositoryRoot(expandHome(path));
    if (to === from) throw rejected(`the project is already at ${to}`);
    if (registry.has(to)) throw rejected(`repository ${to} is already registered`);
    // The queue moves with its tasks; only a run working in the old root holds the project.
    checkNoUnfinishedRuns(from, states);
    database.transaction(() => {
      registry.forget(from, to);
      states.changeStored(from, { moveTo: to });
      queues.moveRepository(from, to);
      tags.moveRepository(from, to);
      observers.forgetRepository(from, to);
    });
    const queue = queues.get(to);
    if (queue !== undefined) queues.save(queue);
    tags.publish(to);
    return to;
  }
}
