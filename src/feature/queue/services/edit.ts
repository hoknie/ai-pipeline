import { rejected } from '../../../platform/errors/index.ts';
import type { AttachmentService } from '../../attachments/services/index.ts';
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
  globalCount,
  moveGlobal,
  dependencyTags,
  editItem,
  spreadTags,
  type Queue,
  type QueueEditRequest,
  type QueueItem,
} from '../types/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { QueueItems } from './items.ts';
import type { TaskLinks } from './links.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

export interface QueueEditDependencies {
  store: QueueStore;
  advance: QueueAdvance;
  items: QueueItems;
  links: TaskLinks;
  taskTags: TaskTags;
  attachments: AttachmentService;
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

  async edit(request: QueueEditRequest): Promise<Queue> {
    const { store, advance, registry, items, links, now } = this.dependencies;
    const queue = store.lines.ownerOf(await registry.rootOf(request.repository), request.item);
    const repository = queue.repository;
    const moment = now();
    const existing = queue.items.find((candidate) => candidate.id === request.item);
    // In the global mode the position is a place among the tasks of all projects.
    const global = store.scope() === 'global';
    const place = global ? request.position : undefined;
    if (place !== undefined) this.checkGlobalPosition(place);
    // The tags before the edit: those added by it spread to the items that wait for this one.
    const before = existing?.tags ?? [];
    if (existing?.run && request.parent !== undefined) {
      throw rejected('a returned run keeps its own task');
    }
    const plan = links.planEdit(repository, request, existing?.run != null);
    const params: QueueEditRequest = {
      ...request,
      after: plan.after,
      parent: plan.parent,
    };
    const changesAttachments = this.checkAttachments(existing, params);
    let skip = params.skip;
    if (existing?.run && skip !== undefined) {
      await this.skipInRun(queue, existing, params);
      skip = undefined;
    }
    if (existing?.run) this.checkReturned(params, skip);
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
    const after = params.after === undefined ? undefined : items.resolveDependencies(params.after);
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
    const patch = {
      ...{ pipeline, variant, task, groups, title, autoDeliver, deliveryMode },
      position: global ? undefined : position,
    };
    const fields = { ...patch, skip, after, postponed };
    const tags = await this.tagsOf(queue, existing, params, fields, moment);
    if (existing && changesAttachments) {
      // The edit is checked on a copy first: no file is stored for an edit that is refused.
      editItem(structuredClone(queue), params.item, { ...fields, tags }, moment, store.findItem);
      await this.dependencies.attachments.ingest({
        repository,
        itemId: params.item,
        sources: params.attach ?? [],
        detach: params.detach ?? [],
      });
    }
    editItem(queue, params.item, { ...fields, tags }, moment, store.findItem);
    const edited = queue.items.find((candidate) => candidate.id === params.item);
    if (edited) {
      const added = edited.tags.filter((id) => !before.includes(id));
      spreadTags(queue, params.item, added, moment);
    }
    links.replaceFor(params.item, plan);
    if (global && existing && (place !== undefined || existing.error !== null)) {
      moveGlobal(store.all(), params.item, place ?? 1);
      store.saveEverything();
    } else {
      store.save(queue);
    }
    await advance.advance(repository);
    return queue;
  }

  /** Before any check of the new values: a returned run answers with its own error. */
  private checkReturned(params: QueueEditRequest, skip: string[] | undefined): void {
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

  private checkGlobalPosition(position: number): void {
    const count = globalCount(this.dependencies.store.all());
    if (!Number.isInteger(position) || position < 1 || position > count) {
      throw rejected(`position must be an integer from 1 to ${count}`);
    }
  }

  /**
   * Whether the edit changes attachments. The attachments of a returned run belong to the run and
   * do not change: refused before any write.
   */
  private checkAttachments(existing: QueueItem | undefined, params: QueueEditRequest): boolean {
    const changes = (params.attach ?? []).length > 0 || (params.detach ?? []).length > 0;
    if (existing?.run && changes) throw rejected('a returned run keeps its own attachments');
    return changes;
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
    if (params.position !== undefined && this.dependencies.store.scope() === 'project') {
      checkPosition(queue, params.position);
    }
    if (params.after !== undefined) {
      const after = [...new Set(items.resolveDependencies(params.after))];
      checkDependencies(this.dependencies.store.findItem, params.item, after);
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
    fields: Parameters<typeof editItem>[2],
    moment: number,
  ): Promise<string[] | undefined> {
    const { tags: catalogs, runs } = this.dependencies;
    const catalog = () => catalogs.of(queue.repository);
    let tags = params.tags === undefined ? undefined : resolveManualTags(catalog(), params.tags);
    if (existing && tags !== undefined) {
      tags = keepLinkedTags(catalog(), knownTags(catalog(), existing.tags), tags);
    }
    if (existing && typeof params.parent === 'string') {
      editItem(
        structuredClone(queue),
        params.item,
        fields,
        moment,
        this.dependencies.store.findItem,
      );
    }
    if (existing && params.parent !== undefined) {
      const parentTag = await this.dependencies.links.parentTag(
        queue.repository,
        typeof params.parent === 'string' ? params.parent : null,
      );
      const rest = withoutLinkedTags(catalog(), tags ?? existing.tags);
      tags = mergeTags(parentTag ? [parentTag.id] : [], rest);
    }
    if (existing && fields.after !== undefined) {
      const fresh = fields.after.filter((ref) => !existing.after.includes(ref));
      const inherited = knownTags(
        catalog(),
        dependencyTags(
          queue,
          fresh,
          (id) => {
            const run = runs.states.lookup(id)?.run;
            return run?.repository === queue.repository ? run.tags : undefined;
          },
          this.dependencies.store.findItem,
        ),
      );
      if (inherited.length > 0) tags = mergeTags(tags ?? existing.tags, inherited);
    }
    return tags;
  }
}
