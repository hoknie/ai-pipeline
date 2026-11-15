import type { Database } from '../../../platform/sqlite/index.ts';
import type { AttachmentService } from '../../attachments/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import type { QueueObservePort, QueuePublishPort, RepairPolicyPort } from '../ports/index.ts';
import { QueueRepository } from '../repositories/index.ts';

import { QueueAdvance } from './advance.ts';
import { QueueControl } from './control.ts';
import { QueueEdit } from './edit.ts';
import { QueueItems } from './items.ts';
import { QueueProjects } from './projects.ts';
import { QueueScope } from './scope.ts';
import { QueueStore } from './store.ts';
import { TaskTags } from './task-tags.ts';

export interface QueueServices {
  store: QueueStore;
  scope: QueueScope;
  advance: QueueAdvance;
  items: QueueItems;
  projects: QueueProjects;
  edit: QueueEdit;
  control: QueueControl;
  taskTags: TaskTags;
}

export function createQueueServices(dependencies: {
  database: Database;
  runs: RunsServices;
  attachments: AttachmentService;
  tags: TagCatalogService;
  registry: RegistryService;
  config: ConfigService;
  now: () => number;
  repair: RepairPolicyPort;
  observe: QueueObservePort;
  publish: QueuePublishPort;
}): QueueServices {
  const { database, runs, attachments, tags, registry, config, now } = dependencies;
  const queues = new QueueRepository(database);
  const store = new QueueStore({ queues, states: runs.states, now, publish: dependencies.publish });
  const { repair, observe } = dependencies;
  const scope = new QueueScope({ store, config, runs, now });
  const advance = new QueueAdvance({
    ...{ store, scope, registry, runs, tags, attachments, config, repair, observe, now },
  });
  const taskTags = new TaskTags({ database, store, tags, registry, runs, now });
  const shared = {
    database,
    store,
    advance,
    taskTags,
    attachments,
    tags,
    registry,
    config,
    runs,
    now,
  };
  const items = new QueueItems(shared);
  const projects = new QueueProjects({
    ...{ database, store, queues, advance, taskTags, tags, registry, config, items, now },
    publish: dependencies.publish,
  });
  return {
    store,
    scope,
    advance,
    items,
    projects,
    edit: new QueueEdit({ ...shared, items }),
    control: new QueueControl(shared),
    taskTags,
  };
}
