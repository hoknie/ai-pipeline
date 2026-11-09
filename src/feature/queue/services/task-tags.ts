import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { runName, type RunState } from '../../runs/types/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import {
  autoTagName,
  knownTags,
  linkedTagOf,
  mergeTags,
  removeTag,
  resolveManualTags,
  resolveTags,
  type Tag,
} from '../../tags/types/index.ts';
import { dependencyTags, spreadTags, type Queue } from '../types/index.ts';

import type { QueueStore } from './store.ts';

export interface TaskTagsDependencies {
  database: Database;
  store: QueueStore;
  tags: TagCatalogService;
  registry: RegistryService;
  runs: Pick<RunsServices, 'states' | 'engine'>;
  now: () => number;
}

/** The tags of runs and queue items: the queue is the one feature that sees tags and runs. */
export class TaskTags {
  private readonly dependencies: TaskTagsDependencies;

  constructor(dependencies: TaskTagsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * `tag_remove`: takes the tag off every run and queue item, in the database and in memory,
   * then publishes. Returns the root of the repository whose catalog changed.
   */
  async remove(params: { repository: string; tag: string }): Promise<string> {
    const { database, store, tags, registry, runs, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    const { id } = removeTag(tags.of(repository), params.tag);
    // Three tables, one transaction: the scenario is opened here, each feature changes its own.
    database.transaction(() => {
      tags.deleteStored(repository, id);
      runs.states.changeStored(repository, { dropTag: id });
      store.dropItemTag(repository, id);
    });
    tags.forget(id);
    for (const state of runs.states.all()) {
      if (state.run.repository === repository && state.run.tags.includes(id)) {
        const rest = state.run.tags.filter((tag) => tag !== id);
        await runs.engine.apply(state, { kind: 'tags_set', tags: rest });
      }
    }
    for (const queue of store.all()) {
      if (queue.repository !== repository) continue;
      if (!queue.items.some((item) => item.tags.includes(id))) continue;
      for (const item of queue.items) item.tags = item.tags.filter((tag) => tag !== id);
      queue.updatedAt = now();
      store.save(queue);
    }
    tags.publish(repository);
    return repository;
  }

  /** Own tags plus the tags of the predecessors in `after`, only those still in the catalog. */
  inherit(queue: Queue, own: string[], after: string[]): string[] {
    const { runs, tags } = this.dependencies;
    const inherited = dependencyTags(queue, after, (id) => runs.states.lookup(id)?.run.tags);
    return knownTags(tags.of(queue.repository), mergeTags(own, inherited));
  }

  /** `run_tags`: adds and removes tags of a run; added tags spread to the tasks that wait for it. */
  async runTags(params: {
    runId: string;
    add?: string[] | undefined;
    remove?: string[] | undefined;
  }): Promise<RunState> {
    const { runs, tags, store, now } = this.dependencies;
    const state = runs.states.get(params.runId);
    const catalog = tags.of(state.run.repository);
    const add = resolveManualTags(catalog, params.add ?? []);
    const remove = new Set(resolveTags(catalog, params.remove ?? []));
    const current = knownTags(catalog, state.run.tags).filter((id) => !remove.has(id));
    const next = [...current, ...add.filter((id) => !current.includes(id) && !remove.has(id))];
    await runs.engine.apply(state, { kind: 'tags_set', tags: next });
    const added = next.filter((id) => !current.includes(id));
    if (added.length > 0) {
      const queue = store.of(state.run.repository);
      if (spreadTags(queue, state.run.id, added, now()).length > 0) store.save(queue);
    }
    return state;
  }

  /**
   * The linked task tag of a parent for a task of `repository`. A parent from another
   * repository gives no tag: the catalogs are per repository, and nothing is created there.
   */
  async parentTagFor(repository: string, parent: RunState): Promise<Tag | null> {
    return parent.run.repository === repository ? this.linkedTagFor(parent) : null;
  }

  /**
   * The linked task tag of the run: the existing one or a new one named after the run.
   * The tag goes to the run itself too (first), and to the items that wait for it.
   */
  async linkedTagFor(state: RunState): Promise<Tag> {
    const { tags, runs, store, now } = this.dependencies;
    const run = state.run;
    const catalog = tags.of(run.repository);
    let tag = linkedTagOf(catalog, run.id);
    if (!tag) {
      const base = run.name ?? (run.title ? runName(run.title) : run.id);
      tag = tags.create({
        repository: run.repository,
        name: autoTagName(catalog, base),
        task: { run: run.id, number: run.number },
      });
      tags.publish(run.repository);
    }
    const own = knownTags(tags.of(run.repository), run.tags);
    if (!own.includes(tag.id)) {
      await runs.engine.apply(state, { kind: 'tags_set', tags: [tag.id, ...own] });
      const queue = store.of(run.repository);
      if (spreadTags(queue, run.id, [tag.id], now()).length > 0) store.save(queue);
    }
    return tag;
  }
}
