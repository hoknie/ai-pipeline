import { randomInt } from 'node:crypto';

import type { AttachmentSource } from '../../attachments/types/index.ts';
import { rejected } from '../../../platform/errors/index.ts';
import type { AttachmentService } from '../../attachments/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { checkSkip, isRunFinished, type RunState } from '../../runs/types/index.ts';
import { requireDeliveryMode, type ConfigService } from '../../swarm-config/services/index.ts';
import {
  DEFAULT_VARIANT,
  checkVariant,
  findPipeline,
  defaultProviderOf,
  providerProblem,
  variantSkip,
} from '../../swarm-config/types/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import { mergeTags, resolveManualTags } from '../../tags/types/index.ts';
import {
  addItem,
  queueItemId,
  refuseDuplicate,
  removeItem,
  startQueue,
  type Enqueued,
  type ItemFields,
  type Queue,
  type QueueAddRequest,
  type QueueItem,
  type QueueChange,
  type LinkPlan,
  type TaskFields,
} from '../types/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { TaskLinks } from './links.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

export interface QueueItemsDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  taskTags: TaskTags;
  links: TaskLinks;
  attachments: AttachmentService;
  tags: TagCatalogService;
  registry: RegistryService;
  config: ConfigService;
  runs: Pick<RunsServices, 'states' | 'engine' | 'effects' | 'cleanup'>;
  now: () => number;
  /** Receives the messages of the daemon; a failed cleanup is written here. */
  log?: (message: string) => void;
}

/** The fields of a new item without the tags, which are resolved separately. */
function fields(
  request: TaskFields & Pick<ItemFields, 'postponed' | 'author' | 'createdBySystem'>,
): ItemFields {
  const { pipeline, variant, provider, task, groups, title, autoDeliver, deliveryMode } = request;
  const { skip, after, inheritTags, postponed, author, createdBySystem } = request;
  return {
    ...{ pipeline, variant, provider, task, groups, title, autoDeliver, deliveryMode },
    ...{ skip, after, inheritTags, postponed, author, createdBySystem },
  };
}

/** The tasks of a queue: added by the user or a specialist, and removed. */
export class QueueItems {
  private readonly dependencies: QueueItemsDependencies;

  constructor(dependencies: QueueItemsDependencies) {
    this.dependencies = dependencies;
  }

  /** `run`: the task goes to the end of the queue, a stopped queue is started, then the queue advances. */
  async enqueue(params: QueueAddRequest): Promise<Enqueued> {
    const { store, advance, registry, tags, links, runs, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    registry.requireEnabled(repository);
    requireDeliveryMode(this.dependencies.config, params.deliveryMode);
    const queue = store.of(repository);
    const moment = now();
    params = { ...params, provider: this.providerFor(repository, params.provider) };
    await this.ensureItem(
      repository,
      params.pipeline,
      params.variant,
      params.skip,
      params.provider,
    );
    const plan = links.plan(repository, params, params.links);
    const { after } = plan;
    const manual = resolveManualTags(tags.of(repository), params.tags ?? []);
    const { postponed: _postponed, ...task } = fields({ ...params, after });
    refuseDuplicate(queue, task, params.allowDuplicate);
    if (plan.parent !== null) this.checkNewItem(queue, task, moment);
    const parentTag = await links.parentTag(repository, plan.parent);
    const own = mergeTags(parentTag ? [parentTag.id] : [], manual);
    const item = await this.addWithAttachments(
      queue,
      { ...task, tags: this.dependencies.taskTags.inherit(queue, own, after, task.inheritTags) },
      params.attachments,
      moment,
    );
    const global = store.scope() === 'global';
    // A stopped queue is started: the queue of the project, or in the global mode the global one.
    const stopped = global ? store.globalQueue() : queue;
    if (!global && stopped.status === 'stopped') {
      startQueue(
        queue,
        queue.runs.flatMap((id) => runs.states.lookup(id) ?? []),
        moment,
      );
    }
    links.replaceFor(item.id, plan);
    store.save(queue);
    if (global && stopped.status === 'stopped') {
      const line = store.lines.line(repository);
      startQueue(
        line,
        line.runs.flatMap((id) => runs.states.lookup(id) ?? []),
        moment,
      );
      store.save(line);
    }
    const started = await advance.advance(repository);
    const run = started.get(item.id) ?? null;
    const stop = global ? store.globalQueue().stop : queue.stop;
    if (!run && stop?.kind === 'item' && stop.item === item.id) {
      throw rejected(stop.error);
    }
    return { item: item.id, number: item.number, run, queue };
  }

  /** `queue_add`: the task goes to the queue, which advances. */
  async add(params: QueueAddRequest): Promise<QueueChange> {
    const repository = await this.dependencies.registry.rootOf(params.repository);
    return this.addTo(repository, params);
  }

  /** `queue_remove`: the item leaves the queue; a returned run it stood for is released. */
  async remove(params: { repository: string; item: string }): Promise<Queue> {
    const { store, registry, runs, attachments, now } = this.dependencies;
    const queue = store.lines.ownerOf(await registry.rootOf(params.repository), params.item);
    const removed = queue.items.find((candidate) => candidate.id === params.item);
    const touched = removeItem(
      queue,
      params.item,
      now(),
      (id) => runs.states.lookup(id),
      store.all(),
    );
    // A returned run keeps its attachments: they belong to the run, not to the item.
    if (removed && removed.run === null) await attachments.removeOwner(removed.id);
    const held = removed?.run ? runs.states.lookup(removed.run) : undefined;
    if (held && held.run.hold !== null) {
      await runs.engine.apply(held, { kind: 'hold', hold: null });
    }
    if (held) await this.cleanReturned(held);
    for (const other of touched) {
      store.save(other);
      // An item of another project that waited for the removed one may be ready now.
      if (other.repository !== queue.repository)
        this.dependencies.advance.request(other.repository);
    }
    this.dependencies.links.onRemoved(params.item);
    return store.save(queue);
  }

  /** A finished returned run goes with its item: worktrees and service refs, not the branch. */
  private async cleanReturned(state: RunState): Promise<void> {
    if (!isRunFinished(state) || state.run.cleanedAt !== null) return;
    try {
      await this.dependencies.runs.cleanup.clean(state, { all: false });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.dependencies.log?.(`cleaning up run ${state.run.id} failed: ${reason}`);
    }
  }

  /**
   * The provider of a new task: the one the request names, `null` for «no provider», and the
   * default provider of the project when the request does not say.
   */
  providerFor(repository: string, provider: string | null | undefined): string | null {
    if (provider !== undefined) return provider;
    return defaultProviderOf(this.dependencies.config.load(repository));
  }

  /** Rejects an unknown pipeline or variant, or a `skip` that does not fit the pipeline with it. */
  async ensureItem(
    repository: string,
    pipeline: string,
    variant: string = DEFAULT_VARIANT,
    skip: readonly string[] = [],
    provider: string | null | undefined = null,
  ) {
    const config = this.dependencies.config.load(repository);
    if (!findPipeline(config, pipeline)) {
      const known = config.pipelines.map((candidate) => candidate.id).join(', ') || 'none';
      throw rejected(`unknown pipeline \`${pipeline}\`; known: ${known}`);
    }
    const variantError = checkVariant(config, pipeline, variant);
    if (variantError !== null) throw rejected(variantError);
    const error = checkSkip(config, pipeline, [...variantSkip(config, pipeline, variant), ...skip]);
    if (error !== null) throw rejected(error);
    const providerError =
      provider === null || provider === undefined ? null : providerProblem(config, provider);
    if (providerError !== null) throw rejected(providerError);
  }

  /** The ids a task waits for: ids of queue items or runs of any project (see `TaskLinks.resolveAfter`). */
  resolveDependencies(ids: string[]): string[] {
    return this.dependencies.links.resolveAfter(ids);
  }

  /**
   * Adds a task to the queue of `repository`, which advances. `inherited` replaces the tags of the
   * request and `specialistRun` is the parent: both are set for a task of a specialist.
   */
  async addTo(
    repository: string,
    params: TaskFields &
      Pick<
        QueueAddRequest,
        | 'tags'
        | 'parent'
        | 'postponed'
        | 'attachments'
        | 'author'
        | 'createdBySystem'
        | 'allowDuplicate'
      >,
    inherited?: string[],
    specialistRun?: string,
  ): Promise<QueueChange> {
    const { store, advance, tags, taskTags, links, now } = this.dependencies;
    this.dependencies.registry.requireEnabled(repository);
    const queue = store.of(repository);
    const moment = now();
    params = { ...params, provider: this.providerFor(repository, params.provider) };
    await this.ensureItem(
      repository,
      params.pipeline,
      params.variant,
      params.skip,
      params.provider,
    );
    const plan: LinkPlan = links.plan(repository, params, params.links);
    const { after } = plan;
    let own = inherited ?? resolveManualTags(tags.of(repository), params.tags ?? []);
    const task = fields({ ...params, after });
    refuseDuplicate(queue, task, params.allowDuplicate);
    if (specialistRun !== undefined) plan.parent = specialistRun;
    else if (plan.parent !== null) {
      this.checkNewItem(queue, task, moment);
      const parentTag = await links.parentTag(repository, plan.parent);
      own = mergeTags(parentTag ? [parentTag.id] : [], own);
    }
    const item = await this.addWithAttachments(
      queue,
      { ...task, tags: taskTags.inherit(queue, own, after, task.inheritTags) },
      params.attachments,
      moment,
    );
    links.replaceFor(item.id, plan);
    store.save(queue);
    await advance.advance(repository);
    return { queue, item: item.id };
  }

  /**
   * Adds the item together with its attachments: when a file cannot be accepted the item is not
   * added, and when the item is refused the accepted bytes are deleted.
   */
  private async addWithAttachments(
    queue: Queue,
    fields: ItemFields,
    sources: AttachmentSource[] | undefined,
    moment: number,
  ): Promise<QueueItem> {
    const { attachments } = this.dependencies;
    const id = queueItemId(moment, randomInt(36 ** 3));
    // Refused before any byte is written: the checks of the item run on a copy.
    addItem(structuredClone(queue), fields, id, moment, this.dependencies.store.findItem);
    if (sources !== undefined && sources.length > 0) {
      await attachments.ingest({ repository: queue.repository, itemId: id, sources });
    }
    try {
      return addItem(queue, fields, id, moment, this.dependencies.store.findItem);
    } catch (error) {
      await attachments.removeOwner(id);
      throw error;
    }
  }

  /** Runs the checks of `addItem` on a copy of the queue: nothing changes. */
  checkNewItem(queue: Queue, fields: ItemFields, now: number): void {
    addItem(
      structuredClone(queue),
      fields,
      queueItemId(now, 0),
      now,
      this.dependencies.store.findItem,
    );
  }
}
