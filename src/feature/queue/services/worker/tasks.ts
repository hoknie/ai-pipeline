import { rejected } from '../../../../platform/errors/index.ts';
import type { RegistryService } from '../../../repos/services/index.ts';
import type { RunsServices } from '../../../runs/services/index.ts';
import type { RunState } from '../../../runs/types/index.ts';
import { findSpecialist } from '../../../swarm-config/types/index.ts';
import type { TagCatalogService } from '../../../tags/services/index.ts';
import { knownTags, mergeTags } from '../../../tags/types/index.ts';
import {
  refuseDuplicate,
  type QueueChange,
  type WorkerTaskEditRequest,
  type WorkerTaskRemoveRequest,
  type WorkerTaskRequest,
} from '../../types/index.ts';

import type { QueueAdvance } from '../advance.ts';
import type { QueueEdit } from '../edit.ts';
import type { QueueItems } from '../items.ts';
import type { TaskLinks } from '../links.ts';
import type { QueueStore } from '../store.ts';
import type { TaskTags } from '../task-tags.ts';

export interface WorkerTasksDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  items: QueueItems;
  edit: QueueEdit;
  links: TaskLinks;
  taskTags: TaskTags;
  tags: TagCatalogService;
  registry: RegistryService;
  runs: Pick<RunsServices, 'states' | 'engine' | 'effects'>;
  now: () => number;
}

const PARENT_IS_THE_RUN = "a specialist's task has its run as the parent";

/**
 * The queue as a specialist with `queue: true` works with it: it adds tasks to the queue of the
 * repository of its run, and changes or removes the waiting tasks of that run.
 */
export class WorkerTasks {
  private readonly dependencies: WorkerTasksDependencies;

  constructor(dependencies: WorkerTasksDependencies) {
    this.dependencies = dependencies;
  }

  /** `worker_queue_add`: the task gets the run as its parent and the tags of the run. */
  add(params: WorkerTaskRequest): Promise<QueueChange> {
    const { runs, store, items, taskTags, links, tags, registry, now } = this.dependencies;
    return runs.engine.serial(async () => {
      const state = this.runOf(params.token);
      const repository = state.run.repository;
      registry.requireEnabled(repository);
      // A task of a specialist takes the default provider, not the provider of its own run.
      params = { ...params, provider: items.providerFor(repository, params.provider) };
      await items.ensureItem(
        repository,
        params.pipeline,
        params.variant,
        params.skip,
        params.provider,
      );
      const queue = store.of(repository);
      if (params.links?.some((link) => link.kind === 'parent')) throw rejected(PARENT_IS_THE_RUN);
      const { after } = links.plan(repository, params, params.links);
      const { token: _token, links: _links, ...task } = params;
      // The task of a specialist has the author of the run it comes from.
      const author = { author: state.run.author, createdBySystem: state.run.createdBySystem };
      // Refused before the linked task tag of the run is created.
      refuseDuplicate(queue, task);
      items.checkNewItem(queue, { ...task, after, ...author }, now());
      // Every task carries the linked task tag of its run, then the other tags of the run.
      const tag = await taskTags.linkedTagFor(state);
      const inherited = mergeTags([tag.id], knownTags(tags.of(repository), state.run.tags));
      return items.addTo(repository, { ...params, ...author }, inherited, state.run.id);
    });
  }

  /** `worker_queue_edit`: the fields of a waiting task of the run change as `queue_edit` changes them. */
  edit(params: WorkerTaskEditRequest): Promise<QueueChange> {
    const { runs, edit } = this.dependencies;
    return runs.engine.serial(async () => {
      const state = this.runOf(params.token);
      this.ownTask(state, params.item);
      const { token: _token, links, ...fields } = params;
      if (links?.some((link) => link.kind === 'parent')) throw rejected(PARENT_IS_THE_RUN);
      const queue = await edit.edit({
        ...fields,
        repository: state.run.repository,
        // Links replace every link of the item: the parent stays the run.
        ...(links === undefined
          ? {}
          : { links: [...links, { kind: 'parent', target: state.run.id }] }),
      });
      return { queue, item: params.item };
    });
  }

  /** `worker_queue_remove`: a waiting task of the run leaves the queue as `queue_remove` removes it. */
  remove(params: WorkerTaskRemoveRequest): Promise<QueueChange> {
    const { runs, items, advance } = this.dependencies;
    return runs.engine.serial(async () => {
      const state = this.runOf(params.token);
      this.ownTask(state, params.item);
      const repository = state.run.repository;
      const queue = await items.remove({ repository, item: params.item });
      // An item that waited only for the removed one may be ready now.
      await advance.advance(repository);
      return { queue, item: params.item };
    });
  }

  /** The run of a running attempt of a specialist that may work with the queue. */
  private runOf(token: string): RunState {
    const { runs } = this.dependencies;
    const key = runs.effects.attemptFor(token);
    if (!key) throw rejected('unknown or expired report token');
    const state = runs.states.get(key.run);
    const attempt = state.groups
      .find((group) => group.slug === key.group)
      ?.attempts.find((candidate) => candidate.seq === key.seq);
    if (!attempt || attempt.status !== 'running') {
      throw rejected('unknown or expired report token');
    }
    if (findSpecialist(state.run.config, attempt.specialist)?.queue !== true) {
      throw rejected(`specialist \`${attempt.specialist}\` may not add tasks to the queue`);
    }
    return state;
  }

  /**
   * Refuses an item that is not a task of the run: a waiting item of the queue of the repository
   * of the run that is not a returned run and has the run as its parent.
   */
  private ownTask(state: RunState, id: string): void {
    const { store, links } = this.dependencies;
    const found = store.findItem(id);
    if (!found) throw rejected('unknown queue item');
    const own =
      found.queue.repository === state.run.repository &&
      found.item.run === null &&
      links.index.parentOf(id) === state.run.id;
    if (!own) throw rejected(`task ${id} was not queued by this run`);
  }
}
