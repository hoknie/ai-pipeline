import type { Database } from '../../../platform/sqlite/index.ts';
import type { AttachmentService } from '../../attachments/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import type { QueueObservePort, QueuePublishPort, RepairPolicyPort } from '../ports/index.ts';
import { QueueRepository, TaskLinksRepository } from '../repositories/index.ts';

import { QueueAdvance } from './advance.ts';
import { QueueControl } from './control.ts';
import { QueueEdit } from './edit.ts';
import { QueueItems } from './items.ts';
import { TaskLinks } from './links.ts';
import { QueueProjects } from './projects.ts';
import { QueueScope } from './scope.ts';
import { QueueStore } from './store.ts';
import { TaskTags } from './task-tags.ts';
import { WorkerTasks } from './worker/tasks.ts';

export interface QueueServices {
  store: QueueStore;
  scope: QueueScope;
  advance: QueueAdvance;
  items: QueueItems;
  projects: QueueProjects;
  edit: QueueEdit;
  /** The queue as a specialist with `queue: true` works with it. */
  worker: WorkerTasks;
  control: QueueControl;
  taskTags: TaskTags;
  links: TaskLinks;
}

/** The runs whose return item stands in a queue, read from the database without a daemon. */
export function queuedRunIds(database: Database): Set<string> {
  return new Set(new QueueRepository(database, new TaskLinksRepository(database)).queuedRunIds());
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
  log?: (message: string) => void;
}): QueueServices {
  const { database, runs, attachments, tags, registry, config, now } = dependencies;
  const linksTable = new TaskLinksRepository(database);
  const queues = new QueueRepository(database, linksTable);
  const store = new QueueStore({ queues, states: runs.states, now, publish: dependencies.publish });
  const { repair, observe } = dependencies;
  const scope = new QueueScope({ store, config, runs, now });
  const taskTags = new TaskTags({ database, store, tags, registry, runs, now });
  const editing: { current?: QueueEdit } = {};
  const links = new TaskLinks({
    ...{ database, links: linksTable, store, taskTags, tags, registry, runs, now },
    publish: dependencies.publish,
    edit: () => editing.current as QueueEdit,
  });
  const advance = new QueueAdvance({
    ...{ store, scope, registry, runs, tags, attachments, config, repair, observe, links, now },
  });
  const shared = {
    database,
    store,
    advance,
    taskTags,
    links,
    attachments,
    tags,
    registry,
    config,
    runs,
    now,
    ...(dependencies.log ? { log: dependencies.log } : {}),
  };
  const items = new QueueItems(shared);
  const projects = new QueueProjects({
    ...{ database, store, queues, advance, taskTags, tags, registry, config, items, now },
    publish: dependencies.publish,
  });
  const edit = new QueueEdit({ ...shared, items });
  editing.current = edit;
  return {
    store,
    scope,
    advance,
    items,
    projects,
    edit,
    worker: new WorkerTasks({ ...shared, items, edit }),
    control: new QueueControl(shared),
    taskTags,
    links,
  };
}
