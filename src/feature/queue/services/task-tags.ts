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
  resolveManualTags,
  resolveTags,
  type Tag,
} from '../../tags/types/index.ts';
import { dependencyTags, spreadTags, checkParentCycle, type Queue } from '../types/index.ts';

import type { LinkIndex } from './link-index.ts';
import type { TaskLinksRepository } from '../repositories/index.ts';
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
   * `tag_remove`: takes the tags off every run and queue item, in the database and in memory,
   * then publishes once. All names are resolved first: an unknown one rejects the whole request.
   * Returns the root of the repository whose catalog changed.
   */
  async remove(params: { repository: string; tags: readonly string[] }): Promise<string> {
    const { database, store, tags, registry, runs, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    const ids = new Set(resolveTags(tags.of(repository), params.tags));
    const hit = (list: readonly string[]) => list.some((tag) => ids.has(tag));
    const keep = (list: readonly string[]) => list.filter((tag) => !ids.has(tag));
    // Three tables, one transaction: the scenario is opened here, each feature changes its own.
    database.transaction(() => {
      for (const id of ids) {
        tags.deleteStored(repository, id);
        runs.states.changeStored(repository, { dropTag: id });
        store.dropTag(repository, id);
      }
    });
    for (const id of ids) tags.forget(id);
    for (const state of runs.states.all()) {
      if (state.run.repository === repository && hit(state.run.tags)) {
        await runs.engine.apply(state, { kind: 'tags_set', tags: keep(state.run.tags) });
      }
    }
    for (const queue of store.all()) {
      if (queue.repository !== repository) continue;
      if (!hit(queue.filter.tags) && !queue.items.some((item) => hit(item.tags))) continue;
      for (const item of queue.items) item.tags = keep(item.tags);
      queue.filter = { ...queue.filter, tags: keep(queue.filter.tags) };
      queue.updatedAt = now();
      store.save(queue);
    }
    tags.publish(repository);
    return repository;
  }

  /** Own tags plus the tags of the predecessors in `after`, only those still in the catalog. */
  inherit(queue: Queue, own: string[], after: string[]): string[] {
    const { runs, tags } = this.dependencies;
    const inherited = dependencyTags(
      queue,
      after,
      (id) => {
        const run = runs.states.lookup(id)?.run;
        return run?.repository === queue.repository ? run.tags : undefined;
      },
      this.dependencies.store.findItem,
    );
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

/** What changing the parent of a run needs: the services around the tags and the links. */
export interface RunParentChange {
  runs: Pick<RunsServices, 'states' | 'engine'>;
  store: QueueStore;
  tags: TagCatalogService;
  taskTags: TaskTags;
  links: TaskLinksRepository;
  now: () => number;
}

/** The parent of a run changes; the linked tag of the old parent goes, that of the new one comes first. */
export async function setRunParent(
  deps: RunParentChange,
  index: LinkIndex,
  run: string,
  parent: string | null,
): Promise<void> {
  const { runs, store, tags, taskTags, links, now } = deps;
  const state = runs.states.get(run);
  if (parent !== null) checkParentCycle((other) => index.parentOf(other), run, parent);
  const old = index.parentOf(run);
  const catalog = tags.of(state.run.repository);
  let next = knownTags(catalog, state.run.tags);
  const oldTag = old === undefined ? undefined : linkedTagOf(catalog, old);
  if (oldTag) next = next.filter((id) => id !== oldTag.id);
  const target = parent === null ? undefined : runs.states.lookup(parent);
  const added: string[] = [];
  if (target && target.run.repository === state.run.repository) {
    const tag = await taskTags.linkedTagFor(target);
    next = mergeTags([tag.id], next);
    added.push(tag.id);
  }
  const rows = parent === null ? [] : [{ kind: 'parent' as const, target: parent }];
  links.replaceSource(run, ['parent'], rows, now());
  if (next.join() !== state.run.tags.join()) {
    await runs.engine.apply(state, { kind: 'tags_set', tags: next });
  }
  const queue = store.of(state.run.repository);
  if (spreadTags(queue, run, added, now()).length > 0) store.save(queue);
}

/**
 * `blocked_by` of a returned run is a link of its return item: the run waits in the queue through
 * that item, so the link changes like the link of any waiting task. Anything else stays as it is.
 */
export function linkSource(
  deps: { store: QueueStore; runs: Pick<RunsServices, 'states'> },
  source: { id: string; ref: 'item' | 'run' },
  kind: string,
): { id: string; ref: 'item' | 'run' } {
  if (source.ref !== 'run' || kind !== 'blocked_by') return source;
  const repository = deps.runs.states.lookup(source.id)?.run.repository;
  const item = repository && deps.store.get(repository)?.items.find((i) => i.run === source.id);
  return item ? { id: item.id, ref: 'item' } : source;
}
