import { rejected } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import { mergeTags, parseParentRef, type Tag } from '../../tags/types/index.ts';
import type { QueuePublishPort } from '../ports/index.ts';
import type { TaskLinksRepository } from '../repositories/index.ts';
import {
  type LinkInput,
  type LinkKind,
  type LinkPlan,
  type QueueEditRequest,
  checkLinkKind,
  checkLinks,
  checkParentCycle,
  resolveLinks,
} from '../types/index.ts';

import { LinkIndex } from './link-index.ts';
import { linkSource, setRunParent } from './task-tags.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

/** A task a link points at: an item of a queue or a run. */
export interface TaskRef {
  id: string;
  ref: 'item' | 'run';
}

/** The links a `queue_edit` changes; a part that is absent stays as it is. */
export interface EditPlan {
  after?: string[];
  parent?: string | null;
  others?: LinkPlan['others'];
}

export interface TaskLinksDependencies {
  database: Database;
  links: TaskLinksRepository;
  store: QueueStore;
  taskTags: TaskTags;
  tags: TagCatalogService;
  registry: RegistryService;
  runs: Pick<RunsServices, 'states' | 'engine'>;
  publish: QueuePublishPort;
  /** `queue_edit`, which holds the rules of the fields of an item; set once the service exists. */
  edit: () => { edit(params: QueueEditRequest): Promise<unknown> };
  now: () => number;
}

const COMBINED = 'links cannot be combined with after or parent';

/** Links of tasks: resolving references, the checks, the changes and the move to a run. */
export class TaskLinks {
  private readonly dependencies: TaskLinksDependencies;
  readonly index: LinkIndex;

  constructor(dependencies: TaskLinksDependencies) {
    this.dependencies = dependencies;
    this.index = new LinkIndex({
      links: dependencies.links,
      store: dependencies.store,
      states: dependencies.runs.states,
    });
  }

  /**
   * The item or the run a reference names: an id first (an item that became a run is its run),
   * then a task number of `repository` (a run, or else a waiting item).
   */
  resolveTaskRef(repository: string | null, ref: string | number, what = 'task'): TaskRef {
    const { store, runs } = this.dependencies;
    const parsed = parseParentRef(ref);
    if (parsed.id !== null) {
      if (store.findItem(parsed.id)) return { id: parsed.id, ref: 'item' };
      if (runs.states.lookup(parsed.id)) return { id: parsed.id, ref: 'run' };
      const started = runs.states.runOfQueueItem(null, parsed.id);
      if (started) return { id: started.run.id, ref: 'run' };
    }
    if (parsed.number !== null && repository !== null) {
      const id = runs.states.idByNumber(repository, parsed.number);
      if (id !== null && runs.states.lookup(id)) return { id, ref: 'run' };
      const waiting = store.get(repository)?.items.find((item) => item.number === parsed.number);
      if (waiting) return { id: waiting.id, ref: 'item' };
    }
    throw rejected(`unknown ${what} \`${ref}\``);
  }

  /** The ids a task waits for: a waiting item or a run; an item that became a run is its run. */
  resolveAfter(ids: string[]): string[] {
    return [...new Set(ids)].map((id) => {
      const { store, runs } = this.dependencies;
      if (store.findItem(id) || runs.states.lookup(id)) return id;
      const started = runs.states.runOfQueueItem(null, id);
      if (started) return started.run.id;
      throw rejected(`unknown dependency \`${id}\``);
    });
  }

  /** The links of a new task: `links`, or the short `after` and `parent`; not both. */
  plan(
    repository: string,
    input: { after?: string[] | undefined; parent?: string | number | undefined },
    links?: LinkInput[] | undefined,
  ): LinkPlan {
    if (links !== undefined) {
      if (input.after !== undefined || input.parent !== undefined) throw rejected(COMBINED);
      return resolveLinks((ref) => this.resolveTaskRef(repository, ref).id, links);
    }
    const after = this.resolveAfter(input.after ?? []);
    const parent =
      input.parent === undefined
        ? null
        : this.resolveTaskRef(repository, input.parent, 'parent').id;
    return { after, parent, others: [] };
  }

  /** The links `queue_edit` changes: `links` replace every link of the item. */
  planEdit(repository: string, params: QueueEditRequest, returned: boolean): EditPlan {
    const plan = this.parseEdit(repository, params, returned);
    const { item } = params;
    const outgoing = [
      ...(params.links === undefined ? [] : (plan.after ?? [])).map((target) => ({
        source: item,
        kind: 'blocked_by' as const,
        target,
      })),
      ...(plan.parent ? [{ source: item, kind: 'parent' as const, target: plan.parent }] : []),
      ...(plan.others ?? []).map((link) => ({ source: item, ...link })),
    ];
    checkLinks(item, outgoing, false);
    if (plan.parent) checkParentCycle((id) => this.index.parentOf(id), item, plan.parent);
    return plan;
  }

  private parseEdit(repository: string, params: QueueEditRequest, returned: boolean): EditPlan {
    const { links, after, parent } = params;
    if (links === undefined) {
      return {
        ...(after === undefined ? {} : { after: this.resolveAfter(after) }),
        ...(parent === undefined
          ? {}
          : {
              parent: parent === null ? null : this.resolveTaskRef(repository, parent, 'parent').id,
            }),
      };
    }
    if (after !== undefined || parent !== undefined) throw rejected(COMBINED);
    if (returned && links.some((link) => link.kind !== 'blocked_by')) {
      throw rejected('a returned run keeps its own task');
    }
    const plan = resolveLinks((ref) => this.resolveTaskRef(repository, ref).id, links);
    return returned
      ? { after: plan.after }
      : { after: plan.after, parent: plan.parent, others: plan.others };
  }

  /** The links of `source` other than `blocked_by` become the parent and the other links. */
  replaceFor(
    source: string,
    plan: { parent?: string | null | undefined; others?: LinkPlan['others'] | undefined },
  ): void {
    const { links, now } = this.dependencies;
    const kinds: LinkKind[] = [];
    const next: { kind: LinkKind; target: string }[] = [];
    if (plan.parent !== undefined) {
      kinds.push('parent');
      if (plan.parent !== null) next.push({ kind: 'parent', target: plan.parent });
    }
    if (plan.others !== undefined) {
      kinds.push('related', 'duplicates');
      next.push(...plan.others);
    }
    if (kinds.length > 0) links.replaceSource(source, kinds, next, now());
  }

  /** The linked tag of the parent for a task of `repository`; a parent that is an item gives none yet. */
  async parentTag(repository: string, parent: string | null): Promise<Tag | null> {
    if (parent === null) return null;
    const { store, runs, taskTags } = this.dependencies;
    const item = store.findItem(parent)?.item;
    const state = runs.states.lookup(item?.run ?? parent);
    return state ? taskTags.parentTagFor(repository, state) : null;
  }

  /** `task_link`: connects two tasks of any state. */
  async link(params: {
    source: string | number;
    kind: string;
    target: string | number;
    repository?: string | undefined;
  }): Promise<string> {
    const kind = checkLinkKind(params.kind);
    const ends = await endsOf(
      this.dependencies.registry,
      (repo, ref) => this.resolveTaskRef(repo, ref),
      params,
    );
    const source = linkSource(this.dependencies, ends.source, kind);
    const { target } = ends;
    checkLinks(source.id, [{ source: source.id, kind, target: target.id }], source.ref === 'run');
    const touched = [source.id, target.id];
    if (kind === 'related' || kind === 'duplicates') {
      const same = this.index
        .from(source.id)
        .some((l) => l.kind === kind && l.target === target.id);
      const back =
        kind === 'related' &&
        this.index.from(target.id).some((l) => l.kind === kind && l.target === source.id);
      if (!same && !back)
        this.dependencies.links.add(
          { source: source.id, kind, target: target.id },
          this.dependencies.now(),
        );
    } else if (source.ref === 'item') {
      await editItem(this.dependencies, this.index, source.id, kind, target.id, 'add');
    } else {
      await setRunParent(this.dependencies, this.index, source.id, target.id);
    }
    this.announce([...touched, ...touched.flatMap((id) => this.index.neighbours(id))]);
    return source.id;
  }

  /** `task_unlink`: removes a link; one that is not there changes nothing. */
  async unlink(params: {
    source: string | number;
    kind: string;
    target: string | number;
    repository?: string | undefined;
  }): Promise<string> {
    const kind = checkLinkKind(params.kind);
    const ends = await endsOf(
      this.dependencies.registry,
      (repo, ref) => this.resolveTaskRef(repo, ref),
      params,
    );
    const { target } = ends;
    const { links } = this.dependencies;
    const has = (from: string, to: string) =>
      this.index.from(from).some((link) => link.kind === kind && link.target === to);
    // A blocked_by moved to the run when the task started stays a link of the run.
    const moved = linkSource(this.dependencies, ends.source, kind);
    const source =
      !has(moved.id, target.id) && has(ends.source.id, target.id) ? ends.source : moved;
    const touched = [source.id, target.id];
    if (kind === 'related' || kind === 'duplicates') {
      links.remove({ source: source.id, kind, target: target.id });
      if (kind === 'related') links.remove({ source: target.id, kind, target: source.id });
    } else if (!has(source.id, target.id)) {
      return source.id;
    } else if (source.ref === 'item') {
      await editItem(this.dependencies, this.index, source.id, kind, target.id, 'remove');
    } else if (kind === 'parent') {
      await setRunParent(this.dependencies, this.index, source.id, null);
    } else {
      links.remove({ source: source.id, kind, target: target.id });
    }
    this.announce([...touched, ...touched.flatMap((id) => this.index.neighbours(id))]);
    return source.id;
  }

  /** The item is a run now: its links belong to the run, and the waiting children get the run's tag. */
  async onStarted(item: string, run: string): Promise<void> {
    const { links, store, runs, taskTags } = this.dependencies;
    const around = [...this.index.neighbours(item), run];
    links.moveRef(item, run);
    const state = runs.states.lookup(run);
    const children = this.index
      .to(run)
      .filter((link) => link.kind === 'parent')
      .flatMap((link) => store.findItem(link.source) ?? []);
    const waiting = children.filter(
      ({ queue, item: child }) =>
        child.run === null && state !== undefined && queue.repository === state.run.repository,
    );
    if (state !== undefined && waiting.length > 0) {
      const tag = await taskTags.linkedTagFor(state);
      for (const { queue, item: child } of waiting) {
        child.tags = mergeTags([tag.id], child.tags);
        queue.updatedAt = this.dependencies.now();
        store.save(queue);
      }
    }
    this.announce([run, ...around, ...this.index.neighbours(run)]);
  }

  /** The item left the queue: every link of it goes. */
  onRemoved(item: string): void {
    const around = this.index.neighbours(item);
    this.dependencies.links.removeRef(item);
    this.announce(around);
  }

  /** The queue event for the queues of the items and the run event for the runs among `ids`. */
  announce(ids: Iterable<string>): void {
    const { store, runs, publish } = this.dependencies;
    const queues = new Map<string, ReturnType<QueueStore['of']>>();
    for (const id of new Set(ids)) {
      const found = store.findItem(id);
      if (found) queues.set(found.queue.repository, found.queue);
      const state = runs.states.lookup(id);
      if (state) publish.runChanged(state);
    }
    for (const queue of queues.values()) publish.queueChecked(queue);
    if (queues.size > 0 && store.scope() === 'global') publish.globalQueueChecked();
  }
}

/** Changes `blocked_by` or `parent` of an item the way `queue_edit` does. */
async function editItem(
  deps: TaskLinksDependencies,
  index: LinkIndex,
  id: string,
  kind: LinkKind,
  target: string,
  change: 'add' | 'remove',
): Promise<void> {
  const found = deps.store.findItem(id);
  if (!found) throw rejected(`unknown task \`${id}\``);
  const { queue, item } = found;
  const base = { repository: queue.repository, item: id };
  if (kind === 'blocked_by') {
    const after = item.after.filter((ref) => ref !== target);
    await deps.edit().edit({ ...base, after: change === 'add' ? [...after, target] : after });
    return;
  }
  if (change === 'add') checkParentCycle((other) => index.parentOf(other), id, target);
  await deps.edit().edit({ ...base, parent: change === 'add' ? target : null });
}

async function endsOf(
  registry: RegistryService,
  resolve: (repository: string | null, ref: string | number) => TaskRef,
  params: { source: string | number; target: string | number; repository?: string | undefined },
) {
  const repository =
    params.repository === undefined ? null : await registry.rootOf(params.repository);
  return { source: resolve(repository, params.source), target: resolve(repository, params.target) };
}
