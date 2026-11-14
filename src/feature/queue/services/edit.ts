import { rejected } from '../../../platform/errors/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { checkSkip, stepStates, type RunState } from '../../runs/types/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import {
  keepLinkedTags,
  knownTags,
  mergeTags,
  resolveManualTags,
  withoutLinkedTags,
} from '../../tags/types/index.ts';
import {
  checkDependencies,
  checkPosition,
  checkReturnedPatch,
  dependencyTags,
  editItem,
  spreadTags,
  type Queue,
  type QueueEditRequest,
  type QueueItem,
} from '../types/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { QueueItems } from './items.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

export interface QueueEditDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  items: QueueItems;
  taskTags: TaskTags;
  tags: TagCatalogService;
  registry: RegistryService;
  runs: Pick<RunsServices, 'states' | 'engine'>;
  now: () => number;
}

/** `queue_edit`: the fields of an item change; a returned run changes its own skipped steps. */
export class QueueEdit {
  private readonly dependencies: QueueEditDependencies;

  constructor(dependencies: QueueEditDependencies) {
    this.dependencies = dependencies;
  }

  async edit(params: QueueEditRequest): Promise<Queue> {
    const { store, advance, registry, items, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    const queue = store.of(repository);
    const moment = now();
    const existing = queue.items.find((candidate) => candidate.id === params.item);
    // The tags before the edit: those added by it spread to the items that wait for this one.
    const before = existing?.tags ?? [];
    if (existing?.run && params.parent !== undefined) {
      throw rejected('a returned run keeps its own task');
    }
    const parentState =
      params.parent === undefined || params.parent === null
        ? null
        : items.resolveParent(repository, params.parent);
    let skip = params.skip;
    if (existing?.run && skip !== undefined) {
      await this.skipInRun(queue, existing, params);
      skip = undefined;
    }
    if (existing?.run) {
      // before any check of the new values: a returned run answers with its own error
      checkReturnedPatch({
        pipeline: params.pipeline,
        variant: params.variant,
        task: params.task,
        groups: params.groups,
        title: params.title,
        tags: params.tags,
        autoDeliver: params.autoDeliver,
        deliveryMode: params.deliveryMode,
        postponed: params.postponed,
        skip,
      });
    }
    if (params.pipeline !== undefined || params.variant !== undefined || skip !== undefined) {
      if (existing) {
        await items.ensureItem(
          repository,
          params.pipeline ?? existing.pipeline,
          params.variant ?? existing.variant,
          skip ?? existing.skip,
        );
      }
    }
    const after =
      params.after === undefined ? undefined : items.resolveDependencies(queue, params.after);
    const {
      pipeline,
      variant,
      task,
      groups,
      title,
      position,
      autoDeliver,
      deliveryMode,
      postponed,
    } = params;
    const patch = { pipeline, variant, task, groups, title, position, autoDeliver, deliveryMode };
    const fields = { ...patch, skip, after, postponed };
    const tags = await this.tagsOf(queue, existing, params, parentState, fields, moment);
    editItem(queue, params.item, { ...fields, tags }, moment);
    const edited = queue.items.find((candidate) => candidate.id === params.item);
    if (edited) {
      const added = edited.tags.filter((id) => !before.includes(id));
      spreadTags(queue, params.item, added, moment);
    }
    store.save(queue);
    await advance.advance(repository);
    return queue;
  }

  /** A returned run has no item-level skip: the steps are skipped in the run itself. */
  private async skipInRun(queue: Queue, item: QueueItem, params: QueueEditRequest): Promise<void> {
    const { runs, items } = this.dependencies;
    const { pipeline, variant, task, groups, title, autoDeliver, deliveryMode, postponed, skip } =
      params;
    checkReturnedPatch(
      {
        pipeline,
        variant,
        task,
        groups,
        title,
        tags: params.tags,
        autoDeliver,
        deliveryMode,
        postponed,
        skip,
      },
      true,
    );
    const state = runs.states.lookup(item.run as string);
    if (!state) throw rejected(`unknown run \`${item.run}\``);
    const changes = this.skipChanges(state, new Set(skip));
    if (params.position !== undefined) checkPosition(queue, params.position);
    if (params.after !== undefined) {
      const after = [...new Set(items.resolveDependencies(queue, params.after))];
      checkDependencies(queue, params.item, after);
    }
    for (const [step, on] of changes) {
      await runs.engine.apply(state, { kind: 'step_skip', step, skip: on });
    }
  }

  /** The steps to skip and to bring back; a step every group has passed cannot change. */
  private skipChanges(state: RunState, wanted: Set<string>): [string, boolean][] {
    const current = new Set(state.run.skippedSteps);
    const skipError = checkSkip(state.run.config, state.run.pipeline, [...wanted]);
    if (skipError !== null) throw rejected(skipError);
    const changes = [
      ...[...current].filter((step) => !wanted.has(step)).map((step) => [step, false]),
      ...[...wanted].filter((step) => !current.has(step)).map((step) => [step, true]),
    ] as [string, boolean][];
    for (const [step] of changes) {
      if (stepStates(state).find((entry) => entry.id === step)?.state === 'done') {
        throw rejected(`step \`${step}\` is already passed by every group`);
      }
    }
    return changes;
  }

  /**
   * The tags of the edited item: the named ones keep the linked tags, a new parent replaces its
   * linked tag, new predecessors give theirs. Every check of the edit runs on a copy before the
   * tag of the parent is created.
   */
  private async tagsOf(
    queue: Queue,
    existing: QueueItem | undefined,
    params: QueueEditRequest,
    parentState: RunState | null,
    fields: Parameters<typeof editItem>[2],
    moment: number,
  ): Promise<string[] | undefined> {
    const { tags: catalogs, taskTags, runs } = this.dependencies;
    const catalog = () => catalogs.of(queue.repository);
    let tags = params.tags === undefined ? undefined : resolveManualTags(catalog(), params.tags);
    if (existing && tags !== undefined) {
      tags = keepLinkedTags(catalog(), knownTags(catalog(), existing.tags), tags);
    }
    if (existing && parentState) editItem(structuredClone(queue), params.item, fields, moment);
    if (existing && params.parent !== undefined) {
      const parentTag = parentState
        ? await taskTags.parentTagFor(queue.repository, parentState)
        : null;
      const rest = withoutLinkedTags(catalog(), tags ?? existing.tags);
      tags = mergeTags(parentTag ? [parentTag.id] : [], rest);
    }
    if (existing && fields.after !== undefined) {
      const fresh = fields.after.filter((ref) => !existing.after.includes(ref));
      const inherited = knownTags(
        catalog(),
        dependencyTags(queue, fresh, (id) => runs.states.lookup(id)?.run.tags),
      );
      if (inherited.length > 0) tags = mergeTags(tags ?? existing.tags, inherited);
    }
    return tags;
  }
}
