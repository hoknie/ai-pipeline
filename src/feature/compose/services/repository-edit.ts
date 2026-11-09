import type { QueueControl, QueueStore } from '../../queue/services/index.ts';
import type { ProjectService, RegistryService } from '../../repos/services/index.ts';
import type { KnownRepository, ProjectChanges } from '../../repos/types/index.ts';

export interface RepositoryEditDependencies {
  registry: RegistryService;
  projects: ProjectService;
  queues: QueueStore;
  control: QueueControl;
}

/** `repository_update`: the attributes of a project change; a disabled project's queue stops. */
export class RepositoryEdit {
  private readonly dependencies: RepositoryEditDependencies;

  constructor(dependencies: RepositoryEditDependencies) {
    this.dependencies = dependencies;
  }

  async update(reference: string, changes: ProjectChanges): Promise<KnownRepository> {
    const { registry, projects, queues, control } = this.dependencies;
    const root = await registry.resolve(reference);
    const project = await projects.update(root, changes);
    const queue = queues.get(root);
    if (
      changes.enabled === false &&
      queue !== undefined &&
      (queue.status === 'running' || queue.stop?.kind === 'limit')
    ) {
      await control.pause({ repository: root });
    }
    return project;
  }
}
