import { rejected } from '../../../platform/errors/index.ts';
import { type RunState, runPhase, runProblems } from '../../runs/types/index.ts';
import { mergeTags } from '../../tags/types/index.ts';
import type { Queue, QueueItem } from './items.ts';
import { BLOCKING_REASONS } from './limit-hits.ts';

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

/**
 * Rejects a dependency list of item `id` (not in the queue yet when adding) that
 * points at the item itself or closes a cycle. Runs have no dependencies, so a
 * cycle can only pass through items.
 */
export function checkDependencies(queue: Queue, id: string, after: string[]): void {
  if (after.includes(id)) throw rejected('a task cannot depend on itself');
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
  if (cycle) throw rejected(`dependency cycle: ${cycle.join(' → ')}`);
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
  if (state.run.hold !== null) return 'waiting';
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
