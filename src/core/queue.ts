import type { NewGroup } from './create.ts';
import { Rejection } from './errors.ts';
import { RUN_TITLE_LIMIT } from './ids.ts';
import { allGroups, runPhase, type RunState } from './model.ts';

export const QUEUE_PARALLEL_MAX = 20;

export interface QueueItem {
  id: string;
  workflow: string;
  task: string | null;
  groups: NewGroup[] | null;
  title: string | null;
  /** `null`: follow `delivery.auto` when the task starts. */
  autoDeliver: boolean | null;
  /** Ids of catalog tags. */
  tags: string[];
  createdAt: number;
  error: string | null;
}

export type ProblemReason = 'needs_human' | 'failed' | 'conflict' | 'cancelled' | 'apply_failed';

/** Problems that stop the queue; a question to a human does not. */
const STOPPING_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'failed',
  'conflict',
  'cancelled',
  'apply_failed',
]);

export interface Problem {
  key: string;
  run: string;
  group: string | null;
  reason: ProblemReason;
}

export type QueueStop =
  | { kind: 'problem'; run: string; group: string | null; reason: ProblemReason }
  | { kind: 'item'; item: string; error: string };

export interface Queue {
  repository: string;
  status: 'stopped' | 'running';
  parallel: number;
  items: QueueItem[];
  /** Runs created by the queue that still occupy a place. */
  runs: string[];
  /** Keys of the problems the user already knows about. */
  acknowledged: string[];
  stop: QueueStop | null;
  updatedAt: number;
}

export interface ItemFields {
  workflow: string;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | undefined;
  tags?: string[] | undefined;
}

export function emptyQueue(repository: string, now: number): Queue {
  return {
    repository,
    status: 'stopped',
    parallel: 1,
    items: [],
    runs: [],
    acknowledged: [],
    stop: null,
    updatedAt: now,
  };
}

function cleanTitle(title: string | null | undefined): string | null {
  if (title === undefined || title === null) return null;
  const trimmed = title.trim();
  if (trimmed === '') throw new Rejection('title must not be empty');
  if ([...trimmed].length > RUN_TITLE_LIMIT) {
    throw new Rejection(`title must be at most ${RUN_TITLE_LIMIT} characters`);
  }
  return trimmed;
}

function cleanGroups(groups: NewGroup[]): NewGroup[] {
  if (groups.length === 0) throw new Rejection('groups must not be empty');
  return groups.map((group) => {
    const title = group.title.trim();
    const task = group.task.trim();
    if (title === '') throw new Rejection('a group title must not be empty');
    if (task === '') throw new Rejection(`group \`${title}\` has an empty task`);
    return { title, task };
  });
}

/** Validates the task or the groups: exactly one of them. */
function cleanBody(fields: {
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
}): Pick<QueueItem, 'task' | 'groups'> {
  if ((fields.task === undefined) === (fields.groups === undefined)) {
    throw new Rejection('pass either task or groups');
  }
  if (fields.task !== undefined) {
    const task = fields.task.trim();
    if (task === '') throw new Rejection('task must not be empty');
    return { task, groups: null };
  }
  return { task: null, groups: cleanGroups(fields.groups ?? []) };
}

function cleanWorkflow(workflow: string): string {
  if (workflow.trim() === '') throw new Rejection('workflow must not be empty');
  return workflow;
}

function find(queue: Queue, id: string): QueueItem {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item) throw new Rejection('unknown queue item');
  return item;
}

export function addItem(queue: Queue, fields: ItemFields, id: string, now: number): QueueItem {
  const item: QueueItem = {
    id,
    workflow: cleanWorkflow(fields.workflow),
    ...cleanBody(fields),
    title: cleanTitle(fields.title),
    autoDeliver: fields.autoDeliver ?? null,
    tags: [...new Set(fields.tags ?? [])],
    createdAt: now,
    error: null,
  };
  queue.items.push(item);
  queue.updatedAt = now;
  return item;
}

export interface ItemPatch {
  workflow?: string | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | null | undefined;
  tags?: string[] | undefined;
  position?: number | undefined;
}

export function editItem(queue: Queue, id: string, patch: ItemPatch, now: number): QueueItem {
  const item = find(queue, id);
  if (patch.task !== undefined && patch.groups !== undefined) {
    throw new Rejection('pass either task or groups');
  }
  const body =
    patch.task !== undefined || patch.groups !== undefined
      ? cleanBody({ task: patch.task, groups: patch.groups })
      : null;
  const workflow = patch.workflow === undefined ? null : cleanWorkflow(patch.workflow);
  const title = patch.title === undefined ? undefined : cleanTitle(patch.title);
  if (patch.position !== undefined) checkPosition(queue, patch.position);
  if (workflow !== null) item.workflow = workflow;
  if (body) Object.assign(item, body);
  if (title !== undefined) item.title = title;
  if (patch.autoDeliver !== undefined) item.autoDeliver = patch.autoDeliver;
  if (patch.tags !== undefined) item.tags = [...new Set(patch.tags)];
  item.error = null;
  if (patch.position !== undefined) placeItem(queue, item, patch.position);
  queue.updatedAt = now;
  return item;
}

export function removeItem(queue: Queue, id: string, now: number): void {
  const item = find(queue, id);
  queue.items = queue.items.filter((candidate) => candidate !== item);
  queue.updatedAt = now;
}

function checkPosition(queue: Queue, position: number): void {
  if (!Number.isInteger(position) || position < 1 || position > queue.items.length) {
    throw new Rejection(`position must be an integer from 1 to ${queue.items.length}`);
  }
}

function placeItem(queue: Queue, item: QueueItem, position: number): void {
  queue.items = queue.items.filter((candidate) => candidate !== item);
  queue.items.splice(position - 1, 0, item);
}

export function moveItem(queue: Queue, id: string, position: number, now: number): void {
  const item = find(queue, id);
  checkPosition(queue, position);
  placeItem(queue, item, position);
  queue.updatedAt = now;
}

export function setParallel(queue: Queue, parallel: number, now: number): void {
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > QUEUE_PARALLEL_MAX) {
    throw new Rejection(`parallel must be an integer from 1 to ${QUEUE_PARALLEL_MAX}`);
  }
  queue.parallel = parallel;
  queue.updatedAt = now;
}

export function pauseQueue(queue: Queue, now: number): void {
  queue.status = 'stopped';
  queue.updatedAt = now;
}

/**
 * Problems of a run. The key includes the number of attempts, so a problem that
 * comes back after a retry is a new one even if nobody saw the state between.
 */
export function runProblems(state: RunState): Problem[] {
  const id = state.run.id;
  const problems: Problem[] = [];
  const work = state.split ? [state.split, ...state.groups] : state.groups;
  for (const group of work) {
    const attempts = group.attempts.length;
    if (
      group.status === 'needs_human' ||
      group.status === 'failed' ||
      group.status === 'conflict'
    ) {
      problems.push({
        key: `${id}/${group.slug}/${group.status}/${attempts}`,
        run: id,
        group: group.slug,
        reason: group.status,
      });
    }
    if (group.status === 'merged' && group.delivery.state === 'apply_failed') {
      problems.push({
        key: `${id}/${group.slug}/apply_failed/${attempts}`,
        run: id,
        group: group.slug,
        reason: 'apply_failed',
      });
    }
  }
  if (runPhase(state) === 'cancelled') {
    const total = allGroups(state).reduce((sum, group) => sum + group.attempts.length, 0);
    problems.push({
      key: `${id}/run/cancelled/${total}`,
      run: id,
      group: null,
      reason: 'cancelled',
    });
  }
  return problems;
}

/** A run keeps its place until it is finished and, with auto delivery, delivered. */
export function occupiesSlot(state: RunState): boolean {
  if (state.run.finishedAt === null) return true;
  if (!state.run.config.delivery.auto) return false;
  return (
    state.run.pendingDelivery !== null ||
    state.groups.some((group) => group.status === 'merged' && group.delivery.state === 'pending')
  );
}

function queueStates(queue: Queue, states: Iterable<RunState>): RunState[] {
  const wanted = new Set(queue.runs);
  return [...states].filter((state) => wanted.has(state.run.id));
}

/** Starts the queue; the problems that exist now become known. */
export function startQueue(queue: Queue, states: Iterable<RunState>, now: number): void {
  queue.status = 'running';
  queue.stop = null;
  for (const item of queue.items) item.error = null;
  const known = new Set(queue.acknowledged);
  for (const state of queueStates(queue, states)) {
    for (const problem of runProblems(state)) known.add(problem.key);
  }
  queue.acknowledged = [...known];
  queue.updatedAt = now;
}

/**
 * Observes the runs of the queue and returns the items to start now. Items leave
 * the queue only through `itemStarted`.
 */
export function advance(
  queue: Queue,
  states: Iterable<RunState>,
  now: number,
): { take: QueueItem[] } {
  const own = queueStates(queue, states);
  const known = new Set(queue.acknowledged);
  if (queue.stop === null) {
    for (const state of own) {
      const fresh = runProblems(state).find(
        (problem) => STOPPING_REASONS.has(problem.reason) && !known.has(problem.key),
      );
      if (!fresh) continue;
      queue.status = 'stopped';
      queue.stop = {
        kind: 'problem',
        run: fresh.run,
        group: fresh.group,
        reason: fresh.reason,
      };
      break;
    }
  }
  const keep = new Set(own.filter(occupiesSlot).map((state) => state.run.id));
  const released = queue.runs.filter((id) => !keep.has(id));
  if (released.length > 0) {
    queue.runs = queue.runs.filter((id) => keep.has(id));
    queue.acknowledged = queue.acknowledged.filter(
      (key) => !released.some((id) => key.startsWith(`${id}/`)),
    );
  }
  let take: QueueItem[] = [];
  if (queue.status === 'running') {
    take = queue.items.slice(0, Math.max(0, queue.parallel - queue.runs.length));
    if (queue.items.length === 0 && queue.runs.length === 0) queue.status = 'stopped';
  }
  queue.updatedAt = now;
  return { take };
}

export function itemStarted(queue: Queue, id: string, run: string, now: number): void {
  const item = find(queue, id);
  queue.items = queue.items.filter((candidate) => candidate !== item);
  queue.runs.push(run);
  queue.updatedAt = now;
}

export function itemFailed(queue: Queue, id: string, error: string, now: number): void {
  const item = find(queue, id);
  item.error = error;
  queue.status = 'stopped';
  queue.stop = { kind: 'item', item: id, error };
  queue.updatedAt = now;
}
