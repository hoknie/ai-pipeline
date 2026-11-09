import type { Database } from '../../../platform/sqlite/index.ts';
import type { ReposPublishPort } from '../ports/index.ts';
import { KnownRepositories } from '../repositories/index.ts';

import { ProjectService } from './projects.ts';
import { RegistryService } from './registry.ts';

export interface ReposServices {
  registry: RegistryService;
  projects: ProjectService;
}

export function createReposServices(dependencies: {
  database: Database;
  now: () => number;
  publish: ReposPublishPort;
}): ReposServices {
  const known = new KnownRepositories(dependencies.database);
  const registry = new RegistryService({
    known,
    now: dependencies.now,
    publish: dependencies.publish,
  });
  return { registry, projects: new ProjectService(registry) };
}
