import type { Queue, QueueItem } from '../items.ts';

/** A waiting task with the project whose queue it stands in. */
export interface GlobalEntry {
  repository: string;
  item: QueueItem;
}

function compare(left: GlobalEntry, right: GlobalEntry): number {
  const a = left.item.globalPosition ?? Number.POSITIVE_INFINITY;
  const b = right.item.globalPosition ?? Number.POSITIVE_INFINITY;
  if (a !== b) return a < b ? -1 : 1;
  return (
    left.item.createdAt - right.item.createdAt || left.item.id.localeCompare(right.item.id, 'en')
  );
}

/** The waiting tasks of every queue in the one order of the global queue. */
export function globalOrder(queues: readonly Queue[]): GlobalEntry[] {
  return queues
    .flatMap((queue) => queue.items.map((item) => ({ repository: queue.repository, item })))
    .sort(compare);
}

/** Gives the tasks the numbers 1, 2, … in the order they are in now. */
function renumber(entries: readonly GlobalEntry[]): void {
  entries.forEach((entry, index) => {
    entry.item.globalPosition = index + 1;
  });
}

/** Turning the global mode on: the order is by the time the tasks were added, then by id. */
export function fillGlobalPositions(queues: readonly Queue[]): void {
  const entries = globalOrder(queues).sort(
    (left, right) =>
      left.item.createdAt - right.item.createdAt || left.item.id.localeCompare(right.item.id, 'en'),
  );
  renumber(entries);
}

/**
 * Items without a position: the item of a returned run goes first, any other task to the end.
 * Returns whether something changed.
 */
export function placeNewItems(queues: readonly Queue[]): boolean {
  const entries = globalOrder(queues);
  if (entries.every((entry) => entry.item.globalPosition !== undefined)) return false;
  const placed = entries.filter((entry) => entry.item.globalPosition !== undefined);
  const fresh = entries.filter((entry) => entry.item.globalPosition === undefined);
  const first = fresh.filter((entry) => entry.item.run !== null);
  const last = fresh.filter((entry) => entry.item.run === null);
  renumber([...first, ...placed, ...last]);
  return true;
}

/** Moves a task to `position` (from 1) of the global order. */
export function moveGlobal(queues: readonly Queue[], id: string, position: number): void {
  const entries = globalOrder(queues);
  const from = entries.findIndex((entry) => entry.item.id === id);
  if (from < 0) return;
  const [moved] = entries.splice(from, 1);
  entries.splice(position - 1, 0, moved!);
  renumber(entries);
}

/** Leaving the global mode: each queue keeps its tasks in their order of the global one. */
export function restoreProjectOrder(queues: readonly Queue[]): void {
  const rank = new Map(globalOrder(queues).map((entry, index) => [entry.item.id, index]));
  for (const queue of queues) {
    queue.items.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
    for (const item of queue.items) delete item.globalPosition;
  }
}

/** The number of tasks waiting in all queues. */
export function globalCount(queues: readonly Queue[]): number {
  return queues.reduce((count, queue) => count + queue.items.length, 0);
}
