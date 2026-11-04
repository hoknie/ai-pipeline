import { DELIVERY_MODES, type DeliveryMode } from '../config/index.ts';

import type { NewGroup } from './create.ts';
import { Rejection } from './errors.ts';
import { RUN_TITLE_LIMIT } from './ids.ts';
import { retryableGroups } from './retryable.ts';
import { cleanSkip } from './skip.ts';
import { mergeTags } from './tags.ts';
import {
  ON_LIMIT_MODES,
  RECOMMENDATION_LIMIT,
  allGroups,
  runPhase,
  type OnLimit,
  type RunState,
} from './model.ts';
import { limitResetsAt } from './scheduler.ts';

export { retryableGroups };

export const QUEUE_PARALLEL_MAX = 20;
/** The most runs the queue remembers as skipped. */
export const QUEUE_SKIPPED_MAX = 10;
/** The most answers in a row the autopilot gives to one group. */
export const AUTOPILOT_ANSWERS_MAX = 3;
/** The answer of the autopilot when the queue has no text of its own. */
export const DEFAULT_AUTOPILOT_ANSWER =
  'I agree with your recommendations; go ahead with them. Where you gave no recommendation, choose the option you consider best and continue without asking again.';

export interface QueueItem {
  id: string;
  /** Integer number of the task within the repository; never reused. */
  number: number;
  workflow: string;
  task: string | null;
  groups: NewGroup[] | null;
  title: string | null;
  /** `null`: follow `delivery.auto` when the task starts. */
  autoDeliver: boolean | null;
  /** `null`: follow `delivery.mode` when the task starts. */
  deliveryMode: DeliveryMode | null;
  /** Ids of catalog tags. */
  tags: string[];
  /** Ids of workflow steps the task skips. */
  skip: string[];
  /** Ids of queue items or runs of the repository that must be done first. */
  after: string[];
  /** A running queue does not take a postponed item; the user starts it or clears the flag. */
  postponed: boolean;
  createdAt: number;
  error: string | null;
  /** A returned run: taking the item retries this run instead of creating one. */
  run: string | null;
}

export type ProblemReason =
  'needs_human' | 'failed' | 'conflict' | 'cancelled' | 'apply_failed' | 'usage_limit';

/** Problems that stop the queue; a question to a human does not, a usage limit stops it its own way. */
const STOPPING_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'failed',
  'conflict',
  'cancelled',
  'apply_failed',
]);

/** Problems that `skipFailed` takes off the places: neither a cancel nor a usage limit. */
const SKIPPED_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'failed',
  'conflict',
  'apply_failed',
]);

/** Problems that block the tasks depending on the run. */
const BLOCKING_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  ...STOPPING_REASONS,
  'usage_limit',
]);

export interface Problem {
  key: string;
  run: string;
  group: string | null;
  reason: ProblemReason;
}

export type QueueStop =
  | { kind: 'problem'; run: string; group: string | null; reason: ProblemReason }
  | { kind: 'item'; item: string; error: string }
  | {
      kind: 'limit';
      run: string;
      group: string;
      runtime: string;
      /** When the limit resets (ms). */
      resetsAt: number;
      /** The queue starts by itself at `resetsAt`. */
      autoResume: boolean;
    };

export interface Queue {
  repository: string;
  status: 'stopped' | 'running';
  parallel: number;
  /** A running queue does not stop when it becomes empty. */
  autopilot: boolean;
  /** A run with a stopping problem leaves its place and the queue goes on. */
  skipFailed: boolean;
  /** Text the autopilot answers the questions of specialists with; `null`: the default text. */
  autopilotAnswer: string | null;
  /** What a usage limit does: the group waits for the reset, or fails. */
  onLimit: OnLimit;
  items: QueueItem[];
  /** The number the next added task gets. */
  nextNumber: number;
  /** Runs created by the queue that still occupy a place. */
  runs: string[];
  /** Keys of the problems the user already knows about. */
  acknowledged: string[];
  /** Runs taken off the places because of a stopping problem, the latest first. */
  skipped: string[];
  stop: QueueStop | null;
  updatedAt: number;
}

export interface ItemFields {
  workflow: string;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | undefined;
  deliveryMode?: DeliveryMode | undefined;
  tags?: string[] | undefined;
  skip?: string[] | undefined;
  after?: string[] | undefined;
  postponed?: boolean | undefined;
}

export function emptyQueue(repository: string, now: number, nextNumber = 1): Queue {
  return {
    repository,
    status: 'stopped',
    parallel: 1,
    autopilot: false,
    skipFailed: false,
    autopilotAnswer: null,
    onLimit: 'wait',
    items: [],
    nextNumber,
    runs: [],
    acknowledged: [],
    skipped: [],
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

function cleanDeliveryMode(mode: DeliveryMode | null | undefined): DeliveryMode | null | undefined {
  if (mode === undefined || mode === null) return mode;
  if (!DELIVERY_MODES.includes(mode)) {
    throw new Rejection(`delivery mode must be one of: ${DELIVERY_MODES.join(', ')}`);
  }
  return mode;
}

function find(queue: Queue, id: string): QueueItem {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item) throw new Rejection('unknown queue item');
  return item;
}

export function addItem(queue: Queue, fields: ItemFields, id: string, now: number): QueueItem {
  const after = [...new Set(fields.after ?? [])];
  checkDependencies(queue, id, after);
  const item: QueueItem = {
    id,
    number: queue.nextNumber,
    workflow: cleanWorkflow(fields.workflow),
    ...cleanBody(fields),
    title: cleanTitle(fields.title),
    autoDeliver: fields.autoDeliver ?? null,
    deliveryMode: cleanDeliveryMode(fields.deliveryMode) ?? null,
    tags: [...new Set(fields.tags ?? [])],
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
  workflow?: string | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | null | undefined;
  deliveryMode?: DeliveryMode | null | undefined;
  tags?: string[] | undefined;
  skip?: string[] | undefined;
  after?: string[] | undefined;
  postponed?: boolean | undefined;
  position?: number | undefined;
}

export function editItem(queue: Queue, id: string, patch: ItemPatch, now: number): QueueItem {
  const item = find(queue, id);
  if (item.run !== null) {
    const { position: _position, after: _after, ...rest } = patch;
    if (Object.values(rest).some((value) => value !== undefined)) {
      throw new Rejection('a returned run keeps its own task');
    }
  }
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
  const after = patch.after === undefined ? undefined : [...new Set(patch.after)];
  if (after !== undefined) checkDependencies(queue, id, after);
  const deliveryMode = cleanDeliveryMode(patch.deliveryMode);
  if (workflow !== null) item.workflow = workflow;
  if (body) Object.assign(item, body);
  if (title !== undefined) item.title = title;
  if (patch.autoDeliver !== undefined) item.autoDeliver = patch.autoDeliver;
  if (deliveryMode !== undefined) item.deliveryMode = deliveryMode;
  if (patch.tags !== undefined) item.tags = [...new Set(patch.tags)];
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

/**
 * Tags of the predecessors in `after`, in the order of the references, without
 * repeats: the tags of a queue item, or `runTags(id)` for a run (unknown: none).
 */
export function dependencyTags(
  queue: Queue,
  after: readonly string[],
  runTags: (id: string) => readonly string[] | undefined,
): string[] {
  return mergeTags(
    ...after.map((ref) => queue.items.find((item) => item.id === ref)?.tags ?? runTags(ref) ?? []),
  );
}

/**
 * Appends the tags `added` to every waiting item that depends on `source` (an
 * item or a run) directly or through a chain of items. Returns the ids of the
 * changed items; a cycle in the data does not loop.
 */
export function spreadTags(
  queue: Queue,
  source: string,
  added: readonly string[],
  now: number,
): string[] {
  if (added.length === 0) return [];
  const reached = new Set([source]);
  const changed: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of queue.items) {
      if (reached.has(item.id) || !item.after.some((ref) => reached.has(ref))) continue;
      reached.add(item.id);
      grew = true;
      const next = mergeTags(item.tags, added);
      if (next.length !== item.tags.length) {
        item.tags = next;
        changed.push(item.id);
      }
    }
  }
  if (changed.length > 0) queue.updatedAt = now;
  return changed;
}

/** The return item of a run: the queue item that retries it when taken; null when there is none. */
export function returnItemOf(queue: Queue, run: string): QueueItem | null {
  return queue.items.find((item) => item.run === run) ?? null;
}

export function removeItem(
  queue: Queue,
  id: string,
  now: number,
  lookup?: (id: string) => RunState | undefined,
): void {
  const item = find(queue, id);
  if (item.run !== null) {
    const state = lookup?.(item.run);
    if (state && state.run.hold !== null && state.run.finishedAt === null) {
      throw new Rejection('a paused run stays in the queue; continue or cancel it');
    }
  }
  queue.items = queue.items.filter((candidate) => candidate !== item);
  for (const other of queue.items) other.after = other.after.filter((ref) => ref !== id);
  queue.updatedAt = now;
}

/**
 * Rejects a dependency list of item `id` (not in the queue yet when adding) that
 * points at the item itself or closes a cycle. Runs have no dependencies, so a
 * cycle can only pass through items.
 */
export function checkDependencies(queue: Queue, id: string, after: string[]): void {
  if (after.includes(id)) throw new Rejection('a task cannot depend on itself');
  const refs = (item: string): string[] =>
    item === id ? after : (queue.items.find((candidate) => candidate.id === item)?.after ?? []);
  const walk = (current: string, path: string[]): string[] | null => {
    for (const next of refs(current)) {
      if (next === id) return [...path, next];
      if (path.includes(next)) continue;
      if (!queue.items.some((candidate) => candidate.id === next)) continue;
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  const cycle = walk(id, [id]);
  if (cycle) throw new Rejection(`dependency cycle: ${cycle.join(' → ')}`);
}

export type DependencyState = 'done' | 'waiting' | 'blocked';
export type ItemReadiness = 'ready' | 'waiting' | 'blocked';

/** A run is done when it is finished and every work group is merged and applied. */
export function runDone(state: RunState): boolean {
  return (
    runPhase(state) === 'finished' &&
    state.groups.length > 0 &&
    state.groups.every((group) => group.status === 'merged' && group.delivery.state === 'applied')
  );
}

export function dependencyState(
  queue: Queue,
  ref: string,
  lookup: (id: string) => RunState | undefined,
  seen: ReadonlySet<string> = new Set(),
): DependencyState {
  if (seen.has(ref)) return 'waiting';
  const item = queue.items.find((candidate) => candidate.id === ref);
  if (item) {
    return itemReadiness(queue, item, lookup, new Set([...seen, ref])) === 'blocked'
      ? 'blocked'
      : 'waiting';
  }
  const state = lookup(ref);
  if (!state) return 'blocked';
  if (runProblems(state).some((problem) => BLOCKING_REASONS.has(problem.reason))) return 'blocked';
  return runDone(state) ? 'done' : 'waiting';
}

export function itemReadiness(
  queue: Queue,
  item: QueueItem,
  lookup: (id: string) => RunState | undefined,
  seen: ReadonlySet<string> = new Set(),
): ItemReadiness {
  const states = item.after.map((ref) => dependencyState(queue, ref, lookup, seen));
  if (states.includes('blocked')) return 'blocked';
  return states.every((state) => state === 'done') ? 'ready' : 'waiting';
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

export interface QueueSettingsPatch {
  parallel?: number | undefined;
  autopilot?: boolean | undefined;
  skipFailed?: boolean | undefined;
  /** `null`: the default text. */
  autopilotAnswer?: string | null | undefined;
  onLimit?: OnLimit | undefined;
}

function cleanAnswer(answer: string | null): string | null {
  if (answer === null) return null;
  const trimmed = answer.trim();
  if (trimmed === '') throw new Rejection('autopilot answer must not be empty');
  if ([...trimmed].length > RECOMMENDATION_LIMIT) {
    throw new Rejection(`autopilot answer must be at most ${RECOMMENDATION_LIMIT} characters`);
  }
  return trimmed;
}

/** Changes only the passed settings; the state of the queue stays as is. */
export function setQueueSettings(queue: Queue, patch: QueueSettingsPatch, now: number): void {
  if (
    patch.parallel === undefined &&
    patch.autopilot === undefined &&
    patch.skipFailed === undefined &&
    patch.autopilotAnswer === undefined &&
    patch.onLimit === undefined
  ) {
    throw new Rejection('pass parallel, autopilot, autopilotAnswer, skipFailed or onLimit');
  }
  if (patch.onLimit !== undefined && !ON_LIMIT_MODES.includes(patch.onLimit)) {
    throw new Rejection(`onLimit must be one of: ${ON_LIMIT_MODES.join(', ')}`);
  }
  const answer =
    patch.autopilotAnswer === undefined ? undefined : cleanAnswer(patch.autopilotAnswer);
  if (patch.parallel !== undefined) setParallel(queue, patch.parallel, now);
  if (patch.autopilot !== undefined) queue.autopilot = patch.autopilot;
  if (patch.skipFailed !== undefined) queue.skipFailed = patch.skipFailed;
  if (answer !== undefined) queue.autopilotAnswer = answer;
  if (patch.onLimit !== undefined) queue.onLimit = patch.onLimit;
  queue.updatedAt = now;
}

/** Stops the queue; a queue stopped by a usage limit no longer starts by itself. */
export function pauseQueue(queue: Queue, now: number): void {
  queue.status = 'stopped';
  if (queue.stop?.kind === 'limit') queue.stop = { ...queue.stop, autoResume: false };
  queue.updatedAt = now;
}

/** When a queue stopped by a usage limit starts by itself; null when it does not. */
export function queueWakeAt(queue: Queue): number | null {
  return queue.status === 'stopped' && queue.stop?.kind === 'limit' && queue.stop.autoResume
    ? queue.stop.resetsAt
    : null;
}

interface LimitHit {
  key: string;
  run: string;
  group: string;
  runtime: string;
  resetsAt: number;
}

/** Attempts of a run that ran out of the usage limit, each a problem of its own. */
function limitHits(state: RunState): LimitHit[] {
  return allGroups(state).flatMap((group) =>
    group.attempts.flatMap((attempt) => {
      const resetsAt = limitResetsAt(attempt);
      return resetsAt === null
        ? []
        : [
            {
              key: `${state.run.id}/${group.slug}/usage_limit/${attempt.seq}`,
              run: state.run.id,
              group: group.slug,
              runtime: attempt.runtime,
              resetsAt,
            },
          ];
    }),
  );
}

/** Keys of every problem and usage limit of a run now. */
export function problemKeys(state: RunState): string[] {
  return [
    ...runProblems(state).map((problem) => problem.key),
    ...limitHits(state).map((hit) => hit.key),
  ];
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
      const reason: ProblemReason =
        group.status === 'failed' && group.attempts.at(-1)?.reason?.kind === 'usage_limit'
          ? 'usage_limit'
          : group.status;
      problems.push({
        key: `${id}/${group.slug}/${reason}/${attempts}`,
        run: id,
        group: group.slug,
        reason,
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
  if (state.run.hold !== null) return false;
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
    for (const key of problemKeys(state)) known.add(key);
  }
  queue.acknowledged = [...known];
  queue.updatedAt = now;
}

/** Makes the current problems and usage limits of a run known to the queue. */
export function acknowledgeRun(queue: Queue, state: RunState): void {
  queue.acknowledged = [...new Set([...queue.acknowledged, ...problemKeys(state)])];
}

/**
 * A run revived by a direct retry joins the places of the queue, as with "run now". Returns
 * false and changes nothing for a run of another repository, a run that already holds a place or
 * is skipped, and a run that does not occupy a place. The queue state and its stop stay as they
 * are; `known` (problem keys from before the retry) and the current ones do not stop the queue.
 */
export function adoptRun(
  queue: Queue,
  state: RunState,
  known: readonly string[],
  now: number,
): boolean {
  const id = state.run.id;
  if (state.run.repository !== queue.repository) return false;
  if (queue.runs.includes(id) || queue.skipped.includes(id)) return false;
  if (!occupiesSlot(state)) return false;
  queue.items = queue.items.filter((item) => item.run !== id);
  queue.runs.push(id);
  queue.acknowledged = [...new Set([...queue.acknowledged, ...known, ...problemKeys(state)])];
  queue.updatedAt = now;
  return true;
}

/**
 * Observes the runs of the queue and returns the items to start now. Items leave
 * the queue only through `itemStarted`.
 */
export function advance(
  queue: Queue,
  states: Iterable<RunState>,
  lookup: (id: string) => RunState | undefined,
  now: number,
): { take: QueueItem[] } {
  let own = queueStates(queue, states);
  const wake = queueWakeAt(queue);
  if (wake !== null && now >= wake) startQueue(queue, own, now);
  if (queue.skipFailed) {
    const failed = own.filter(
      (state) =>
        state.run.hold === null &&
        runProblems(state).some((problem) => SKIPPED_REASONS.has(problem.reason)),
    );
    if (failed.length > 0) {
      const ids = new Set(failed.map((state) => state.run.id));
      queue.skipped = [
        ...failed.map((state) => state.run.id).reverse(),
        ...queue.skipped.filter((id) => !ids.has(id)),
      ];
      queue.runs = queue.runs.filter((id) => !ids.has(id));
      queue.acknowledged = queue.acknowledged.filter(
        (key) => ![...ids].some((id) => key.startsWith(`${id}/`)),
      );
      own = own.filter((state) => !ids.has(state.run.id));
    }
  }
  const returned: RunState[] = [];
  queue.skipped = queue.skipped
    .filter((id) => {
      const state = lookup(id);
      if (state === undefined) return false;
      if (runProblems(state).some((problem) => BLOCKING_REASONS.has(problem.reason))) return true;
      if (occupiesSlot(state) && !queue.runs.includes(id)) returned.push(state);
      return false;
    })
    .slice(0, QUEUE_SKIPPED_MAX);
  if (returned.length > 0) {
    queue.runs = [...returned.map((state) => state.run.id), ...queue.runs];
    for (const state of returned) {
      for (const hit of limitHits(state)) queue.acknowledged.push(hit.key);
    }
    own = [...returned, ...own];
  }
  const watched = own.filter((state) => state.run.hold === null);
  stopOnLimit(queue, watched);
  const known = new Set(queue.acknowledged);
  if (queue.stop === null) {
    for (const state of watched) {
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
  // A return item of a finished run with nothing to retry has no purpose left.
  queue.items = queue.items.filter((item) => {
    if (item.run === null) return true;
    const state = lookup(item.run);
    return !(state && state.run.finishedAt !== null && retryableGroups(state).length === 0);
  });
  let take: QueueItem[] = [];
  if (queue.status === 'running') {
    take = queue.items
      .filter(
        (item) =>
          !item.postponed &&
          !(queue.skipFailed && item.error !== null) &&
          itemReadiness(queue, item, lookup) === 'ready',
      )
      .slice(0, Math.max(0, queue.parallel - queue.runs.length));
    if (
      !queue.autopilot &&
      !queue.items.some((item) => !item.postponed) &&
      queue.runs.length === 0
    ) {
      queue.status = 'stopped';
    }
  }
  queue.updatedAt = now;
  return { take };
}

/** A new usage limit of a run of the queue stops it; every such attempt counts once. */
function stopOnLimit(queue: Queue, own: readonly RunState[]): void {
  const known = new Set(queue.acknowledged);
  const fresh = own.flatMap(limitHits).filter((hit) => !known.has(hit.key));
  if (fresh.length === 0) return;
  queue.acknowledged = [...queue.acknowledged, ...fresh.map((hit) => hit.key)];
  const first = fresh[0]!;
  const running = queue.status === 'running';
  if (!running && queue.stop !== null) return;
  queue.status = 'stopped';
  queue.stop = {
    kind: 'limit',
    run: first.run,
    group: first.group,
    runtime: first.runtime,
    resetsAt: Math.max(...fresh.map((hit) => hit.resetsAt)),
    autoResume: running && queue.onLimit === 'wait',
  };
}

/** The queue item that takes `state` back: retries it, or only lifts its hold. */
function returnItem(state: RunState, id: string, now: number): QueueItem {
  return {
    id,
    number: state.run.number,
    workflow: state.run.workflow,
    task: null,
    groups: null,
    title: state.run.title,
    autoDeliver: null,
    deliveryMode: null,
    tags: [...state.run.tags],
    skip: [],
    after: [],
    createdAt: now,
    error: null,
    run: state.run.id,
    postponed: false,
  };
}

/**
 * Puts a run on pause (checked before the hold is set): the run leaves its place and becomes the
 * last item of the queue; taking the item continues it.
 */
export function pauseRun(queue: Queue, state: RunState, id: string, now: number): QueueItem {
  const run = state.run.id;
  if (state.run.hold === null && state.run.finishedAt !== null) {
    throw new Rejection('run has nothing to pause');
  }
  if (state.run.hold !== null) throw new Rejection('run is already paused');
  if (queue.items.some((item) => item.run === run)) {
    throw new Rejection('run is already in the queue');
  }
  const item = returnItem(state, id, now);
  queue.runs = queue.runs.filter((candidate) => candidate !== run);
  queue.skipped = queue.skipped.filter((candidate) => candidate !== run);
  queue.acknowledged = queue.acknowledged.filter((key) => !key.startsWith(`${run}/`));
  queue.items.push(item);
  queue.updatedAt = now;
  return item;
}

/**
 * Puts a run back into the queue as its first item: taking the item retries the failed and
 * cancelled groups of the run, which then holds a place.
 */
export function returnRun(queue: Queue, state: RunState, id: string, now: number): QueueItem {
  const run = state.run.id;
  if (retryableGroups(state).length === 0) {
    throw new Rejection('run has no failed or cancelled groups');
  }
  if (queue.runs.includes(run)) throw new Rejection('run already holds a place in the queue');
  if (queue.items.some((item) => item.run === run)) {
    throw new Rejection('run is already in the queue');
  }
  const item = returnItem(state, id, now);
  queue.items.unshift(item);
  queue.skipped = queue.skipped.filter((skipped) => skipped !== run);
  queue.updatedAt = now;
  return item;
}

/** Whether `returnRun` would take the run: something to retry, and not in the queue yet. */
export function canReturn(queue: Queue, state: RunState): boolean {
  const id = state.run.id;
  return (
    retryableGroups(state).length > 0 &&
    !queue.runs.includes(id) &&
    !queue.items.some((item) => item.run === id)
  );
}

/** Removes a skipped run from the skipped list; the run itself is not changed. */
export function dismissRun(queue: Queue, state: RunState, now: number): void {
  const id = state.run.id;
  if (!queue.skipped.includes(id)) throw new Rejection('run is not in the skipped list');
  queue.skipped = queue.skipped.filter((skipped) => skipped !== id);
  queue.acknowledged = queue.acknowledged.filter((key) => !key.startsWith(`${id}/`));
  queue.updatedAt = now;
}

export interface AutopilotAnswer {
  run: string;
  group: string;
  answer: string;
}

function autopilotStreak(decisions: readonly { by: string }[]): number {
  let streak = 0;
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    if (decisions[index]?.by !== 'autopilot') break;
    streak += 1;
  }
  return streak;
}

/**
 * Questions the autopilot answers now: groups of the runs that hold a place in a
 * running queue, waiting because the specialist reported `needs_human` (not
 * because of a limit or a change outside the worktree), that got fewer than
 * `AUTOPILOT_ANSWERS_MAX` autopilot answers in a row.
 */
export function autopilotAnswers(queue: Queue, states: Iterable<RunState>): AutopilotAnswer[] {
  if (queue.status !== 'running' || !queue.autopilot) return [];
  const answer = queue.autopilotAnswer ?? DEFAULT_AUTOPILOT_ANSWER;
  const result: AutopilotAnswer[] = [];
  for (const state of queueStates(queue, states)) {
    const work = state.split ? [state.split, ...state.groups] : state.groups;
    for (const group of work) {
      if (group.status !== 'needs_human') continue;
      const last = group.attempts.at(-1);
      if (last?.report?.verdict !== 'needs_human' || last.outsideChanges.length > 0) continue;
      if (autopilotStreak(group.decisions) >= AUTOPILOT_ANSWERS_MAX) continue;
      result.push({ run: state.run.id, group: group.slug, answer });
    }
  }
  return result;
}

export function itemStarted(queue: Queue, id: string, run: string, now: number): void {
  const item = find(queue, id);
  queue.items = queue.items.filter((candidate) => candidate !== item);
  for (const other of queue.items) {
    other.after = [...new Set(other.after.map((ref) => (ref === id ? run : ref)))];
  }
  queue.runs.push(run);
  queue.updatedAt = now;
}

export function itemFailed(queue: Queue, id: string, error: string, now: number): void {
  const item = find(queue, id);
  item.error = error;
  if (!queue.skipFailed) {
    queue.status = 'stopped';
    queue.stop = { kind: 'item', item: id, error };
  }
  queue.updatedAt = now;
}
