import { randomInt } from 'node:crypto';

import { errorMessage, isRejected, rejected } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import { directoryName } from '../../repos/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import { findPipeline } from '../../swarm-config/types/index.ts';
import type { TagCatalogService } from '../../tags/services/index.ts';
import { cleanName, defaultTagColor, tagNamed, type Tag } from '../../tags/types/index.ts';
import {
  addItem,
  queueItemId,
  refuseDuplicate,
  type AddedToProject,
  type ItemFields,
  type Queue,
  type QueueAddProjectsRequest,
  type TaskFields,
} from '../types/index.ts';

import type { QueuePublishPort } from '../ports/index.ts';
import type { QueueRepository } from '../repositories/index.ts';

import type { QueueAdvance } from './advance.ts';
import type { QueueItems } from './items.ts';
import type { QueueStore } from './store.ts';
import type { TaskTags } from './task-tags.ts';

export interface QueueProjectsDependencies {
  database: Database;
  store: QueueStore;
  queues: QueueRepository;
  advance: QueueAdvance;
  taskTags: TaskTags;
  tags: TagCatalogService;
  registry: RegistryService;
  config: ConfigService;
  items: QueueItems;
  publish: QueuePublishPort;
  now: () => number;
}

/** The fields of the new item of a task for several projects. */
function fields(
  request: TaskFields & {
    postponed?: boolean | undefined;
    author?: string | null | undefined;
    createdBySystem?: boolean | undefined;
  },
): ItemFields {
  const {
    pipeline,
    variant,
    provider,
    task,
    groups,
    title,
    autoDeliver,
    deliveryMode,
    skip,
    after,
  } = request;
  return {
    pipeline,
    variant,
    provider,
    task,
    groups,
    title,
    autoDeliver,
    deliveryMode,
    skip,
    after,
    ...(request.postponed !== undefined ? { postponed: request.postponed } : {}),
    ...(request.author !== undefined ? { author: request.author } : {}),
    ...(request.createdBySystem !== undefined ? { createdBySystem: request.createdBySystem } : {}),
  };
}

/** One task for the queues of several projects: checked as a whole, written in one transaction. */
export class QueueProjects {
  private readonly dependencies: QueueProjectsDependencies;

  constructor(dependencies: QueueProjectsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * `queue_add_projects`: one task for several projects. Every project is checked before anything
   * is written; the items, the shared tags and the queues are written in one transaction.
   */
  async add(params: QueueAddProjectsRequest): Promise<AddedToProject[]> {
    const { store, queues, advance, registry, tags, taskTags, database, items, now } =
      this.dependencies;
    const roots: string[] = [];
    for (const reference of params.repositories) {
      const root = await registry.resolve(reference);
      if (roots.includes(root)) {
        throw rejected(`project \`${this.labelOf(root)}\` is listed twice`);
      }
      roots.push(root);
    }
    const texts = await this.projectTexts(params, roots);
    const moment = now();
    const after = items.resolveDependencies(params.after ?? []);
    const name =
      params.tag === undefined || params.tag.trim() === '' ? null : cleanName(params.tag);
    const color = name === null ? null : this.sharedColor(roots, name);
    for (const root of roots) {
      const task = fields({ ...params, task: texts.get(root) ?? params.task, after });
      await this.checkProject(root, params, task, moment);
    }

    const snapshots = new Map(roots.map((root) => [root, structuredClone(store.of(root))]));
    const made: Tag[] = [];
    const changed: string[] = [];
    const added: AddedToProject[] = [];
    try {
      database.transaction(() => {
        const used = new Set<string>();
        let previous: string | null = null;
        for (const root of roots) {
          const queue = store.of(root);
          let own: string[] = [];
          if (name !== null && color !== null) {
            const { tag, created } = tags.ensureNamed(root, name, color);
            if (created) {
              made.push(tag);
              changed.push(root);
            }
            own = [tag.id];
          }
          const waits = params.chain === true && previous !== null ? [...after, previous] : after;
          let id = queueItemId(moment, randomInt(36 ** 3));
          while (used.has(id) || store.findItem(id)) id = queueItemId(moment, randomInt(36 ** 3));
          used.add(id);
          const task = fields({ ...params, task: texts.get(root) ?? params.task, after: waits });
          const item = addItem(
            queue,
            { ...task, tags: taskTags.inherit(queue, own, waits) },
            id,
            moment,
            store.findItem,
          );
          queues.saveQueueStored(queue);
          previous = item.id;
          added.push({
            repository: root,
            project: this.labelOf(root),
            item: item.id,
            number: item.number,
          });
        }
      });
    } catch (error) {
      for (const [root, before] of snapshots) Object.assign(store.of(root), before);
      for (const tag of made) tags.forget(tag.id);
      throw error;
    }
    for (const root of changed) tags.publish(root);
    for (const root of roots) this.dependencies.publish.queueSaved(store.of(root));
    for (const root of roots) await advance.advance(root);
    return added;
  }

  /** Every check of the task in one project: the project, the configuration, a copy, the item. */
  private async checkProject(
    root: string,
    params: QueueAddProjectsRequest,
    task: ItemFields,
    moment: number,
  ): Promise<void> {
    const { store, registry } = this.dependencies;
    const label = this.labelOf(root);
    registry.requireEnabled(root);
    await this.ensureIn(root, label, params);
    refuseDuplicate(store.of(root), task, params.allowDuplicate, ` of project \`${label}\``);
    await this.inProject(label, () => this.checkNewItem(store.of(root), task, moment));
  }

  /** Runs the checks of `addItem` on a copy of the queue: nothing changes. */
  private checkNewItem(queue: Queue, item: ItemFields, now: number): void {
    addItem(
      structuredClone(queue),
      item,
      queueItemId(now, 0),
      now,
      this.dependencies.store.findItem,
    );
  }

  /** The slug of a project of the registry: how errors and answers name it. */
  private labelOf(root: string): string {
    return this.dependencies.registry.entry(root)?.slug ?? directoryName(root);
  }

  /** Runs a check of one project; a refusal names the project. */
  private async inProject<T>(label: string, work: () => T | Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isRejected(error)) throw rejected(`${errorMessage(error)} in project \`${label}\``);
      throw error;
    }
  }

  /** The pipeline, the variant, the provider and the skipped steps must exist in the configuration of the project. */
  private async ensureIn(
    root: string,
    label: string,
    params: QueueAddProjectsRequest,
  ): Promise<void> {
    if (!findPipeline(this.dependencies.config.load(root), params.pipeline)) {
      throw rejected(`unknown pipeline \`${params.pipeline}\` in project \`${label}\``);
    }
    await this.inProject(label, () =>
      this.dependencies.items.ensureItem(
        root,
        params.pipeline,
        params.variant,
        params.skip,
        params.provider,
      ),
    );
  }

  /** The text of the item of every project: the shared task and the note of the project, if any. */
  private async projectTexts(
    params: QueueAddProjectsRequest,
    roots: string[],
  ): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    for (const [reference, note] of Object.entries(params.notes ?? {})) {
      const root = await this.dependencies.registry.resolve(reference);
      if (!roots.includes(root)) {
        throw rejected(`note for project \`${reference}\`, which is not in repositories`);
      }
      const text = note.trim();
      if (text !== '') texts.set(root, `${params.task}\n\n${text}`);
    }
    return texts;
  }

  /** The color of the shared tag; refuses a name taken by the tag of a linked task. */
  private sharedColor(roots: string[], name: string): string {
    const { tags } = this.dependencies;
    let color: string | null = null;
    for (const root of roots) {
      const found = tagNamed(tags.of(root), name);
      if (found === undefined) continue;
      if (found.task !== null) {
        throw rejected(
          `tag \`${found.name}\` belongs to task #${found.task.number} and is set automatically in project \`${this.labelOf(root)}\``,
        );
      }
      color ??= found.color;
    }
    return color ?? defaultTagColor(tags.of(roots[0] ?? ''));
  }
}
