import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { TagsPublishPort } from '../ports/index.ts';
import { TagRepository } from '../repositories/index.ts';

import { TagCatalogService } from './catalog.ts';

export interface TagsServices {
  catalog: TagCatalogService;
}

export function createTagsServices(dependencies: {
  database: Database;
  registry: RegistryService;
  now: () => number;
  publish: TagsPublishPort;
}): TagsServices {
  const { database, ...rest } = dependencies;
  return { catalog: new TagCatalogService({ ...rest, tags: new TagRepository(database) }) };
}
