import type { Database } from '../../../platform/sqlite/index.ts';
import type { ReposPublishPort } from '../ports/index.ts';
import { KnownRepositories } from '../repositories/index.ts';

import { RegistryService } from './registry.ts';

export interface ReposServices {
  registry: RegistryService;
}

export function createReposServices(dependencies: {
  database: Database;
  now: () => number;
  publish: ReposPublishPort;
}): ReposServices {
  const known = new KnownRepositories(dependencies.database);
  return {
    registry: new RegistryService({ known, now: dependencies.now, publish: dependencies.publish }),
  };
}
