import { rejected } from '../../../platform/errors/index.ts';
import {
  type RunState,
  allGroups,
  finishedApartFromRepair,
  retryableGroups,
} from '../../runs/types/index.ts';
import type { Queue, QueueItem } from './items.ts';
import { problemKeys } from './limit-hits.ts';

/** The queue item that takes `state` back: retries it, or only lifts its hold. */
export function returnItem(state: RunState, id: string, now: number): QueueItem {
  return {
    id,
    number: state.run.number,
    pipeline: state.run.pipeline,
    variant: state.run.variant,
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

/** The return item of a run: the queue item that retries it when taken; null when there is none. */
export function returnItemOf(queue: Queue, run: string): QueueItem | null {
  return queue.items.find((item) => item.run === run) ?? null;
}

/**
 * Puts a run on pause (checked before the hold is set): the run leaves its place and becomes the
 * last item of the queue. The queue never takes the item of a paused run by itself: only an
 * explicit action lifts the hold. A frozen run already has its item: the item moves to the end.
 */
export function pauseRun(queue: Queue, state: RunState, id: string, now: number): QueueItem {
  const run = state.run.id;
  if (state.run.hold === 'paused') throw rejected('run is already paused');
  if (state.run.hold === 'frozen') {
    const item = returnItemOf(queue, run) ?? returnItem(state, id, now);
    queue.items = [...queue.items.filter((other) => other !== item), item];
    queue.updatedAt = now;
    return item;
  }
  if (state.run.finishedAt !== null) throw rejected('run has nothing to pause');
  if (queue.items.some((item) => item.run === run)) {
    throw rejected('run is already in the queue');
  }
  const item = returnItem(state, id, now);
  queue.runs = queue.runs.filter((candidate) => candidate !== run);
  queue.priority = queue.priority.filter((candidate) => candidate !== run);
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
    throw rejected('run has no failed or cancelled groups');
  }
  if (queue.runs.includes(run)) throw rejected('run already holds a place in the queue');
  if (queue.items.some((item) => item.run === run)) {
    throw rejected('run is already in the queue');
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
  if (!queue.skipped.includes(id)) throw rejected('run is not in the skipped list');
  queue.skipped = queue.skipped.filter((skipped) => skipped !== id);
  queue.acknowledged = queue.acknowledged.filter((key) => !key.startsWith(`${id}/`));
  queue.updatedAt = now;
}

/** A run keeps its place until it is finished and, with auto delivery, delivered. */
export function occupiesSlot(state: RunState): boolean {
  if (state.run.hold !== null) return false;
  if (!finishedApartFromRepair(state)) return true;
  if (!state.run.config.delivery.auto) return false;
  // The delivery a repair started is the observer's, not the place's.
  return (
    (state.run.pendingDelivery !== null && !state.run.pendingDelivery.repair) ||
    state.groups.some((group) => group.status === 'merged' && group.delivery.state === 'pending')
  );
}

/**
 * The run a priority action would freeze: the last of the places that took one, skipping a run
 * that waits for a human, a finished run awaiting delivery, a held run, a priority run and
 * `claimant` itself. `null` when there is none.
 */
export function freezeCandidate(
  queue: Queue,
  states: Iterable<RunState>,
  claimant: string | null,
): string | null {
  const byId = new Map([...states].map((state) => [state.run.id, state]));
  for (const id of [...queue.runs].reverse()) {
    const state = byId.get(id);
    if (!state || id === claimant) continue;
    if (queue.priority.includes(id) || state.run.hold !== null) continue;
    if (finishedApartFromRepair(state)) continue;
    if (allGroups(state).some((group) => group.status === 'needs_human')) continue;
    return id;
  }
  return null;
}

/**
 * Gives `run` a place as a priority run. When every place is taken and a run can be frozen, that
 * run leaves the places and its return item `itemId` goes first in the queue; its id is returned
 * and the caller sets `hold: frozen` on it. Without a candidate the run takes a place over
 * `parallel`. `reserved`: places already given away in the same step (continuing frozen runs).
 */
export function claimPlace(
  queue: Queue,
  states: Iterable<RunState>,
  run: string,
  itemId: string,
  now: number,
  reserved = 0,
): string | null {
  let frozen: string | null = null;
  const list = [...states];
  const others = queue.runs.filter((id) => id !== run).length + reserved;
  if (others >= queue.parallel) {
    const candidate = freezeCandidate(queue, list, run);
    const state = candidate === null ? undefined : list.find((s) => s.run.id === candidate);
    if (candidate !== null && state) {
      queue.runs = queue.runs.filter((id) => id !== candidate);
      queue.priority = queue.priority.filter((id) => id !== candidate);
      queue.acknowledged = queue.acknowledged.filter((key) => !key.startsWith(`${candidate}/`));
      queue.items = queue.items.filter((item) => item.run !== candidate);
      queue.items.unshift(returnItem(state, itemId, now));
      frozen = candidate;
    }
  }
  if (!queue.runs.includes(run)) queue.runs.push(run);
  if (!queue.priority.includes(run)) queue.priority.push(run);
  queue.updatedAt = now;
  return frozen;
}

/**
 * A revived run without a priority action waits for a place: it leaves the skipped list and the
 * old items, and its return item goes first. The places, priority and the run itself stay as they
 * are; the problems known before and the current ones do not stop the queue.
 */
export function deferRun(
  queue: Queue,
  state: RunState,
  known: readonly string[],
  itemId: string,
  now: number,
): QueueItem {
  const run = state.run.id;
  queue.skipped = queue.skipped.filter((id) => id !== run);
  queue.items = queue.items.filter((item) => item.run !== run);
  const item = returnItem(state, itemId, now);
  queue.items.unshift(item);
  queue.acknowledged = [...new Set([...queue.acknowledged, ...known, ...problemKeys(state)])];
  queue.updatedAt = now;
  return item;
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
  claim?: { states: Iterable<RunState>; itemId: string },
): { frozen: string | null } | null {
  const id = state.run.id;
  if (state.run.repository !== queue.repository) return null;
  if (queue.runs.includes(id)) return null;
  if (!occupiesSlot(state)) return null;
  queue.items = queue.items.filter((item) => item.run !== id);
  queue.skipped = queue.skipped.filter((skipped) => skipped !== id);
  const frozen = claim ? claimPlace(queue, claim.states, id, claim.itemId, now) : null;
  if (!claim) queue.runs.push(id);
  queue.acknowledged = [...new Set([...queue.acknowledged, ...known, ...problemKeys(state)])];
  queue.updatedAt = now;
  return { frozen };
}
