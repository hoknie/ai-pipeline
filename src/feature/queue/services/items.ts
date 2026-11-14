import { randomInt } from 'node:crypto';

import type { AttachmentSource } from '../../attachments/types/index.ts';
import { rejected } from '../../../platform/errors/index.ts';
import type { AttachmentService } from '../../attachments/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { checkSkip, type RunState } from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  DEFAULT_VARIANT,
  checkVariant,
  findPipeline,
  findSpecialist,
  variantSkip,
} from '../../swarm-config/types/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import { knownTags, mergeTags, parseParentRef, resolveManualTags } from '../../tags/types/index.ts';
import {
  addItem,
  queueItemId,
  removeItem,
  startQueue,
  type Enqueued,
  type ItemFields,
  type Queue,
  type QueueAddRequest,
  type QueueItem,
  type QueueChange,
  type TaskFields,
  type WorkerTaskRequest,
} from '../types/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

export interface QueueItemsDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  taskTags: TaskTags;
  attachments: AttachmentService;
  tags: TagCatalogService;
  registry: RegistryService;
  config: ConfigService;
  runs: Pick<RunsServices, 'states' | 'engine' | 'effects'>;
  now: () => number;
}

/** The fields of a new item without the tags, which are resolved separately. */
function fields(request: TaskFields & { postponed?: boolean | undefined }): ItemFields {
  const { pipeline, variant, task, groups, title, autoDeliver, deliveryMode, skip, after } =
    request;
  return {
    pipeline,
    variant,
    task,
    groups,
    title,
    autoDeliver,
    deliveryMode,
    skip,
    after,
    ...(request.postponed !== undefined ? { postponed: request.postponed } : {}),
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
    const { store, advance, registry, tags, taskTags, runs, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    registry.requireEnabled(repository);
    const queue = store.of(repository);
    const moment = now();
    await this.ensureItem(repository, params.pipeline, params.variant, params.skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    const manual = resolveManualTags(tags.of(repository), params.tags ?? []);
    const parent =
      params.parent === undefined ? null : this.resolveParent(repository, params.parent);
    const { postponed: _postponed, ...task } = fields({ ...params, after });
    if (parent) this.checkNewItem(queue, task, moment);
    const parentTag = parent ? await taskTags.parentTagFor(repository, parent) : null;
    const own = mergeTags(parentTag ? [parentTag.id] : [], manual);
    const item = await this.addWithAttachments(
      queue,
      { ...task, tags: taskTags.inherit(queue, own, after) },
      params.attachments,
      moment,
    );
    if (queue.status === 'stopped') {
      startQueue(
        queue,
        queue.runs.flatMap((id) => runs.states.lookup(id) ?? []),
        moment,
      );
    }
    store.save(queue);
    const started = await advance.advance(repository);
    const run = started.get(item.id) ?? null;
    if (!run && queue.stop?.kind === 'item' && queue.stop.item === item.id) {
      throw rejected(queue.stop.error);
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
    const queue = store.of(await registry.rootOf(params.repository));
    const removed = queue.items.find((candidate) => candidate.id === params.item);
    removeItem(queue, params.item, now(), (id) => runs.states.lookup(id));
    // A returned run keeps its attachments: they belong to the run, not to the item.
    if (removed && removed.run === null) await attachments.removeOwner(removed.id);
    const held = removed?.run ? runs.states.lookup(removed.run) : undefined;
    if (held && held.run.hold !== null) {
      await runs.engine.apply(held, { kind: 'hold', hold: null });
    }
    return store.save(queue);
  }

  /** A task from a specialist with `queue: true` goes to the queue of the repository of its run. */
  workerAdd(params: WorkerTaskRequest): Promise<QueueChange> {
    const { runs, store, taskTags, tags, now } = this.dependencies;
    return runs.engine.serial(async () => {
      const key = runs.effects.attemptFor(params.token);
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
      // Every task carries the linked task tag of its run, then the other tags of the run.
      const repository = state.run.repository;
      this.dependencies.registry.requireEnabled(repository);
      await this.ensureItem(repository, params.pipeline, params.variant, params.skip);
      const queue = store.of(repository);
      const after = this.resolveDependencies(queue, params.after ?? []);
      this.checkNewItem(queue, fields({ ...params, after }), now());
      const tag = await taskTags.linkedTagFor(state);
      const inherited = mergeTags([tag.id], knownTags(tags.of(repository), state.run.tags));
      return this.addTo(repository, params, inherited);
    });
  }

  /** Rejects an unknown pipeline or variant, or a `skip` that does not fit the pipeline with it. */
  async ensureItem(
    repository: string,
    pipeline: string,
    variant: string = DEFAULT_VARIANT,
    skip: readonly string[] = [],
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
  }

  /**
   * Turns the ids a task waits for into ids of queue items or runs of the repository.
   * An item that already became a run is replaced by that run.
   */
  resolveDependencies(queue: Queue, ids: string[]): string[] {
    const { states } = this.dependencies.runs;
    return [...new Set(ids)].map((id) => {
      if (queue.items.some((item) => item.id === id)) return id;
      const own = states.lookup(id);
      if (own?.run.repository === queue.repository) return id;
      const started = states.runOfQueueItem(queue.repository, id);
      if (started) return started.run.id;
      throw rejected(`unknown dependency \`${id}\``);
    });
  }

  /** The run a `parent` refers to: a run id first, then a task number of the repository. */
  resolveParent(repository: string, ref: string | number): RunState {
    const { states } = this.dependencies.runs;
    const parsed = parseParentRef(ref);
    if (parsed.id !== null) {
      const state = states.lookup(parsed.id);
      if (state) return state;
    }
    if (parsed.number !== null) {
      const id = states.idByNumber(repository, parsed.number);
      const state = id === null ? undefined : states.lookup(id);
      if (state) return state;
    }
    throw rejected(`unknown parent \`${ref}\``);
  }

  private async addTo(
    repository: string,
    params: TaskFields & Pick<QueueAddRequest, 'tags' | 'parent' | 'postponed' | 'attachments'>,
    inherited?: string[],
  ): Promise<QueueChange> {
    const { store, advance, tags, taskTags, now } = this.dependencies;
    this.dependencies.registry.requireEnabled(repository);
    const queue = store.of(repository);
    const moment = now();
    await this.ensureItem(repository, params.pipeline, params.variant, params.skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    let own = inherited ?? resolveManualTags(tags.of(repository), params.tags ?? []);
    const task = fields({ ...params, after });
    if (params.parent !== undefined) {
      const parent = this.resolveParent(repository, params.parent);
      this.checkNewItem(queue, task, moment);
      const parentTag = await taskTags.parentTagFor(repository, parent);
      own = mergeTags(parentTag ? [parentTag.id] : [], own);
    }
    const item = await this.addWithAttachments(
      queue,
      { ...task, tags: taskTags.inherit(queue, own, after) },
      params.attachments,
      moment,
    );
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
    addItem(structuredClone(queue), fields, id, moment);
    if (sources !== undefined && sources.length > 0) {
      await attachments.ingest({ repository: queue.repository, itemId: id, sources });
    }
    try {
      return addItem(queue, fields, id, moment);
    } catch (error) {
      await attachments.removeOwner(id);
      throw error;
    }
  }

  /** Runs the checks of `addItem` on a copy of the queue: nothing changes. */
  private checkNewItem(queue: Queue, fields: ItemFields, now: number): void {
    addItem(structuredClone(queue), fields, queueItemId(now, 0), now);
  }
}
