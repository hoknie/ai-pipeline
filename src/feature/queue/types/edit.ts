import { rejected } from '../../../platform/errors/index.ts';
import {
  type NewGroup,
  type DeliveryBranch,
  type RunState,
  RUN_TITLE_LIMIT,
  cleanSkip,
  checkDeliveryBranch,
} from '../../runs/types/index.ts';
import {
  type DeliveryMode,
  DELIVERY_MODES,
  DEFAULT_VARIANT,
} from '../../swarm-config/types/index.ts';
import { type ItemLookup, checkDependencies, lookupIn } from './dependencies.ts';
import { type ItemFields, type Queue, type QueueItem, findItem } from './items.ts';

function cleanTitle(title: string | null | undefined): string | null {
  if (title === undefined || title === null) return null;
  const trimmed = title.trim();
  if (trimmed === '') throw rejected('title must not be empty');
  if ([...trimmed].length > RUN_TITLE_LIMIT) {
    throw rejected(`title must be at most ${RUN_TITLE_LIMIT} characters`);
  }
  return trimmed;
}

function cleanGroups(groups: NewGroup[]): NewGroup[] {
  if (groups.length === 0) throw rejected('groups must not be empty');
  return groups.map((group) => {
    const title = group.title.trim();
    const task = group.task.trim();
    if (title === '') throw rejected('a group title must not be empty');
    if (task === '') throw rejected(`group \`${title}\` has an empty task`);
    return { title, task };
  });
}

/** Validates the task or the groups: exactly one of them. */
function cleanBody(fields: {
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
}): Pick<QueueItem, 'task' | 'groups'> {
  if ((fields.task === undefined) === (fields.groups === undefined)) {
    throw rejected('pass either task or groups');
  }
  if (fields.task !== undefined) {
    const task = fields.task.trim();
    if (task === '') throw rejected('task must not be empty');
    return { task, groups: null };
  }
  return { task: null, groups: cleanGroups(fields.groups ?? []) };
}

function cleanPipeline(pipeline: string): string {
  if (pipeline.trim() === '') throw rejected('pipeline must not be empty');
  return pipeline;
}

function cleanDeliveryMode(mode: DeliveryMode | null | undefined): DeliveryMode | null | undefined {
  if (mode === undefined || mode === null) return mode;
  if (!DELIVERY_MODES.includes(mode)) {
    throw rejected(`delivery mode must be one of: ${DELIVERY_MODES.join(', ')}`);
  }
  return mode;
}

export function addItem(
  queue: Queue,
  fields: ItemFields,
  id: string,
  now: number,
  find: ItemLookup = lookupIn(queue),
): QueueItem {
  const after = [...new Set(fields.after ?? [])];
  checkDeliveryBranch(fields.deliveryBranch, fields.autoDeliver, fields.deliveryMode);
  checkDependencies(find, id, after);
  const item: QueueItem = {
    id,
    number: queue.nextNumber,
    pipeline: cleanPipeline(fields.pipeline),
    variant: fields.variant ?? DEFAULT_VARIANT,
    provider: fields.provider ?? null,
    author: fields.author ?? null,
    createdBySystem: fields.createdBySystem ?? false,
    ...cleanBody(fields),
    title: cleanTitle(fields.title),
    autoDeliver: fields.autoDeliver ?? null,
    deliveryMode: cleanDeliveryMode(fields.deliveryMode) ?? null,
    deliveryBranch: fields.deliveryBranch ? { ...fields.deliveryBranch } : null,
    tags: [...new Set(fields.tags ?? [])],
    inheritTags: fields.inheritTags ?? true,
    skip: cleanSkip(fields.skip ?? []),
    after,
    postponed: fields.postponed ?? false,
    createdAt: now,
    error: null,
    run: null,
  };
  queue.items.push(item);
  queue.nextNumber += 1;
  queue.updatedAt = now;
  return item;
}

export interface ItemPatch {
  pipeline?: string | undefined;
  variant?: string | undefined;
  provider?: string | null | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | null | undefined;
  deliveryMode?: DeliveryMode | null | undefined;
  deliveryBranch?: DeliveryBranch | null | undefined;
  tags?: string[] | undefined;
  inheritTags?: boolean | undefined;
  skip?: string[] | undefined;
  after?: string[] | undefined;
  postponed?: boolean | undefined;
  position?: number | undefined;
}

/** Rejects a patch of a returned run's item that changes more than its place, `after` and `postponed`; `skip` is allowed when `skipInRun`. */
export function checkReturnedPatch(patch: ItemPatch, skipInRun = false): void {
  const { position: _position, after: _after, postponed: _postponed, skip, ...rest } = patch;
  const others = skipInRun ? rest : { ...rest, skip };
  if (Object.values(others).some((value) => value !== undefined)) {
    throw rejected('a returned run keeps its own task');
  }
}

export function editItem(
  queue: Queue,
  id: string,
  patch: ItemPatch,
  now: number,
  find: ItemLookup = lookupIn(queue),
): QueueItem {
  const item = findItem(queue, id);
  if (item.run !== null) checkReturnedPatch(patch);
  if (patch.task !== undefined && patch.groups !== undefined) {
    throw rejected('pass either task or groups');
  }
  const body =
    patch.task !== undefined || patch.groups !== undefined
      ? cleanBody({ task: patch.task, groups: patch.groups })
      : null;
  const pipeline = patch.pipeline === undefined ? null : cleanPipeline(patch.pipeline);
  const title = patch.title === undefined ? undefined : cleanTitle(patch.title);
  if (patch.position !== undefined) checkPosition(queue, patch.position);
  const after = patch.after === undefined ? undefined : [...new Set(patch.after)];
  if (after !== undefined) checkDependencies(find, id, after);
  const deliveryMode = cleanDeliveryMode(patch.deliveryMode);
  const branch = patch.deliveryBranch === undefined ? item.deliveryBranch : patch.deliveryBranch;
  checkDeliveryBranch(
    branch,
    patch.autoDeliver === undefined ? item.autoDeliver : patch.autoDeliver,
    deliveryMode === undefined ? item.deliveryMode : deliveryMode,
  );
  if (pipeline !== null) item.pipeline = pipeline;
  if (patch.variant !== undefined) item.variant = patch.variant;
  if (patch.provider !== undefined) item.provider = patch.provider;
  if (body) Object.assign(item, body);
  if (title !== undefined) item.title = title;
  if (patch.autoDeliver !== undefined) item.autoDeliver = patch.autoDeliver;
  if (deliveryMode !== undefined) item.deliveryMode = deliveryMode;
  if (patch.deliveryBranch !== undefined)
    item.deliveryBranch = patch.deliveryBranch ? { ...patch.deliveryBranch } : null;
  if (patch.tags !== undefined) item.tags = [...new Set(patch.tags)];
  if (patch.inheritTags !== undefined) item.inheritTags = patch.inheritTags;
  if (patch.skip !== undefined) item.skip = cleanSkip(patch.skip);
  if (after !== undefined) item.after = after;
  if (patch.postponed !== undefined) item.postponed = patch.postponed;
  const hadError = item.error !== null;
  item.error = null;
  if (patch.position !== undefined) placeItem(queue, item, patch.position);
  else if (hadError) placeItem(queue, item, 1);
  queue.updatedAt = now;
  return item;
}

export function removeItem(
  queue: Queue,
  id: string,
  now: number,
  lookup?: (id: string) => RunState | undefined,
  all: readonly Queue[] = [],
): Queue[] {
  const item = findItem(queue, id);
  if (item.run !== null) {
    const state = lookup?.(item.run);
    if (state && state.run.hold !== null && state.run.finishedAt === null) {
      throw rejected(`a ${state.run.hold} run stays in the queue; continue or cancel it`);
    }
  }
  queue.items = queue.items.filter((candidate) => candidate !== item);
  for (const other of queue.items) other.after = other.after.filter((ref) => ref !== id);
  queue.updatedAt = now;
  return dropRef(queue, all, id, now);
}

/** Removes `id` from `after` of the items of the other queues; returns the queues that changed. */
export function dropRef(queue: Queue, all: readonly Queue[], id: string, now: number): Queue[] {
  return rewriteRefs(queue, all, now, (refs) => refs.filter((ref) => ref !== id), id);
}

/** Replaces `id` with `run` in `after` of the items of the other queues; returns those that changed. */
export function replaceRef(
  queue: Queue,
  all: readonly Queue[],
  id: string,
  run: string,
  now: number,
): Queue[] {
  return rewriteRefs(
    queue,
    all,
    now,
    (refs) => [...new Set(refs.map((ref) => (ref === id ? run : ref)))],
    id,
  );
}

function rewriteRefs(
  queue: Queue,
  all: readonly Queue[],
  now: number,
  rewrite: (refs: string[]) => string[],
  id: string,
): Queue[] {
  const changed: Queue[] = [];
  for (const other of all) {
    if (other === queue || !other.items.some((item) => item.after.includes(id))) continue;
    for (const item of other.items) {
      if (item.after.includes(id)) item.after = rewrite(item.after);
    }
    other.updatedAt = now;
    changed.push(other);
  }
  return changed;
}

export function checkPosition(queue: Queue, position: number): void {
  if (!Number.isInteger(position) || position < 1 || position > queue.items.length) {
    throw rejected(`position must be an integer from 1 to ${queue.items.length}`);
  }
}

export function placeItem(queue: Queue, item: QueueItem, position: number): void {
  queue.items = queue.items.filter((candidate) => candidate !== item);
  queue.items.splice(position - 1, 0, item);
}

export function moveItem(queue: Queue, id: string, position: number, now: number): void {
  const item = findItem(queue, id);
  checkPosition(queue, position);
  placeItem(queue, item, position);
  queue.updatedAt = now;
}

/** The item becomes a run; returns the other queues whose items waited for it. */
export function itemStarted(
  queue: Queue,
  id: string,
  run: string,
  now: number,
  all: readonly Queue[] = [],
): Queue[] {
  const item = findItem(queue, id);
  queue.items = queue.items.filter((candidate) => candidate !== item);
  for (const other of queue.items) {
    other.after = [...new Set(other.after.map((ref) => (ref === id ? run : ref)))];
  }
  if (!queue.runs.includes(run)) queue.runs.push(run);
  queue.updatedAt = now;
  return replaceRef(queue, all, id, run, now);
}

export function itemFailed(queue: Queue, id: string, error: string, now: number): void {
  const item = findItem(queue, id);
  item.error = error;
  if (!queue.skipFailed) {
    queue.status = 'stopped';
    queue.stop = { kind: 'item', item: id, error };
  }
  queue.updatedAt = now;
}
