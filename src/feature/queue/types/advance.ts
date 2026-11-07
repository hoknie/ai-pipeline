import { type RunState, retryableGroups, runProblems } from '../../runs/types/index.ts';
import { itemReadiness } from './dependencies.ts';
import { type Queue, type QueueItem, QUEUE_SKIPPED_MAX, newItemId, queueStates } from './items.ts';
import { BLOCKING_REASONS, SKIPPED_REASONS, STOPPING_REASONS, limitHits } from './limit-hits.ts';
import { claimPlace, occupiesSlot } from './returns.ts';
import { queueWakeAt, startQueue } from './settings.ts';

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

/** A run with a stopping problem leaves its place and the queue goes on. */
function skipFailedRuns(queue: Queue, own: RunState[]): RunState[] {
  const failed = own.filter(
    (state) =>
      state.run.hold === null &&
      runProblems(state).some((problem) => SKIPPED_REASONS.has(problem.reason)),
  );
  if (failed.length === 0) return own;
  const ids = new Set(failed.map((state) => state.run.id));
  queue.skipped = [
    ...failed.map((state) => state.run.id).reverse(),
    ...queue.skipped.filter((id) => !ids.has(id)),
  ];
  queue.runs = queue.runs.filter((id) => !ids.has(id));
  queue.acknowledged = queue.acknowledged.filter(
    (key) => ![...ids].some((id) => key.startsWith(`${id}/`)),
  );
  return own.filter((state) => !ids.has(state.run.id));
}

/** Skipped runs that no longer have a problem and occupy a place go back to the places. */
function returnSkippedRuns(queue: Queue, lookup: (id: string) => RunState | undefined): RunState[] {
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
    queue.runs = [...queue.runs, ...returned.map((state) => state.run.id)];
    for (const state of returned) {
      for (const hit of limitHits(state)) queue.acknowledged.push(hit.key);
    }
  }
  return returned;
}

/** A new stopping problem of a watched run stops the queue. */
function stopOnProblem(queue: Queue, watched: readonly RunState[]): void {
  if (queue.stop !== null) return;
  const known = new Set(queue.acknowledged);
  for (const state of watched) {
    const fresh = runProblems(state).find(
      (problem) => STOPPING_REASONS.has(problem.reason) && !known.has(problem.key),
    );
    if (!fresh) continue;
    queue.status = 'stopped';
    queue.stop = { kind: 'problem', run: fresh.run, group: fresh.group, reason: fresh.reason };
    return;
  }
}

/** The items of finished returned runs are no longer needed: what waited for them waits for the run. */
function dropFinishedReturns(queue: Queue, lookup: (id: string) => RunState | undefined): void {
  for (const item of [...queue.items]) {
    if (item.run === null) continue;
    const state = lookup(item.run);
    if (
      state &&
      state.run.finishedAt !== null &&
      state.run.hold === null &&
      retryableGroups(state).length === 0
    ) {
      queue.items = queue.items.filter((candidate) => candidate !== item);
      for (const other of queue.items) {
        other.after = [
          ...new Set(other.after.map((ref) => (ref === item.id ? item.run : ref))),
        ].filter((ref): ref is string => ref !== null);
      }
    }
  }
}

/** Runs that no longer occupy a place leave the places of the queue. */
function releasePlaces(queue: Queue, own: readonly RunState[]): void {
  const keep = new Set(own.filter(occupiesSlot).map((state) => state.run.id));
  const released = queue.runs.filter((id) => !keep.has(id));
  if (released.length === 0) return;
  queue.runs = queue.runs.filter((id) => keep.has(id));
  queue.acknowledged = queue.acknowledged.filter(
    (key) => !released.some((id) => key.startsWith(`${id}/`)),
  );
}

/** Frozen runs go first, in any state of the queue, as soon as a place is free. */
function takeFrozen(queue: Queue, lookup: (id: string) => RunState | undefined): QueueItem[] {
  const take: QueueItem[] = [];
  for (const item of queue.items) {
    if (item.run === null || lookup(item.run)?.run.hold !== 'frozen') continue;
    if (queue.runs.length + take.length >= queue.parallel) break;
    take.push(item);
  }
  return take;
}

/** Returned runs without a hold take a place at once, freezing the last run that took one. */
function takeReturned(
  queue: Queue,
  own: readonly RunState[],
  lookup: (id: string) => RunState | undefined,
  now: number,
  result: { take: QueueItem[]; freeze: string[] },
): void {
  const live = (): RunState[] => own.filter((state) => queue.runs.includes(state.run.id));
  for (const item of [...queue.items]) {
    if (item.run === null || item.postponed) continue;
    if (queue.skipFailed && item.error !== null) continue;
    const state = lookup(item.run);
    if (!state || state.run.hold !== null || retryableGroups(state).length === 0) continue;
    if (itemReadiness(queue, item, lookup) !== 'ready') continue;
    const frozen = claimPlace(queue, live(), item.run, newItemId(queue, now), now);
    if (frozen !== null) result.freeze.push(frozen);
    result.take.push(item);
  }
}

/** The ready items that fit into the free places. */
function takeReady(
  queue: Queue,
  lookup: (id: string) => RunState | undefined,
  take: readonly QueueItem[],
  frozenTaken: number,
): QueueItem[] {
  const free = Math.max(0, queue.parallel - queue.runs.length - frozenTaken);
  return queue.items
    .filter(
      (item) =>
        !take.includes(item) &&
        !item.postponed &&
        !(item.run !== null && lookup(item.run)?.run.hold === 'paused') &&
        !(queue.skipFailed && item.error !== null) &&
        itemReadiness(queue, item, lookup) === 'ready',
    )
    .slice(0, free);
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
): { take: QueueItem[]; freeze: string[] } {
  let own = queueStates(queue, states);
  const wake = queueWakeAt(queue);
  if (wake !== null && now >= wake) startQueue(queue, own, now);
  if (queue.skipFailed) own = skipFailedRuns(queue, own);
  own = [...own, ...returnSkippedRuns(queue, lookup)];
  const watched = own.filter((state) => state.run.hold === null);
  stopOnLimit(queue, watched);
  stopOnProblem(queue, watched);
  dropFinishedReturns(queue, lookup);
  releasePlaces(queue, own);
  const result = { take: takeFrozen(queue, lookup), freeze: [] as string[] };
  const frozenTaken = result.take.length;
  if (queue.status === 'running') {
    takeReturned(queue, own, lookup, now, result);
    result.take.push(...takeReady(queue, lookup, result.take, frozenTaken));
    if (
      !queue.autopilot &&
      !queue.items.some((item) => !item.postponed) &&
      queue.runs.length === 0
    ) {
      queue.status = 'stopped';
    }
  }
  queue.priority = queue.priority.filter((id) => queue.runs.includes(id));
  queue.updatedAt = now;
  return result;
}
