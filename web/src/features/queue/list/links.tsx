import { createContext, useContext } from 'react';

import type { DependencyView, QueueItemView, QueueView } from '../../../shared/api/types.ts';

/** What the queue page knows about the other projects: their queues and a way to open one. */
export interface QueueLinks {
  /** The queues of the other enabled projects: their tasks and runs can be waited for. */
  others: readonly QueueView[];
  /** Makes the project the panel's repository and opens its queue. */
  openProject?: ((path: string) => void) | undefined;
}

const NONE: QueueLinks = { others: [] };

export const QueueLinksContext = createContext<QueueLinks>(NONE);

export const useQueueLinks = (): QueueLinks => useContext(QueueLinksContext);

/** Deepest branch indent: longer chains do not indent further. */
export const MAX_DEPTH = 3;

type Linked = Pick<QueueView, 'items'>;

/** The items that wait for `id` (an item or a run). */
export function dependents(queue: Linked, id: string): QueueItemView[] {
  const source = queue.items.find((item) => item.id === id);
  const ids = new Set(
    source?.linkedBy.filter((link) => link.kind === 'blocked_by').map((link) => link.id) ?? [],
  );
  return queue.items.filter((item) => ids.has(item.id));
}

/**
 * `id` together with everything linked to it: predecessors and dependents, transitively in both
 * directions. Items and runs share one id space, so a run id is part of the result too.
 */
export function related(queue: Linked, id: string): Set<string> {
  const result = new Set<string>([id]);
  const edges = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };
  for (const item of queue.items) {
    for (const ref of item.after) connect(item.id, ref.id);
    for (const link of [...item.links, ...item.linkedBy])
      if (link.kind === 'blocked_by' || link.kind === 'parent') connect(item.id, link.id);
  }
  const pending = [id];
  while (pending.length > 0) {
    for (const other of edges.get(pending.pop()!) ?? []) {
      if (result.has(other)) continue;
      result.add(other);
      pending.push(other);
    }
  }
  return result;
}

/** Length of the longest chain of waiting predecessors of the item, at most `MAX_DEPTH`. */
export function depth(queue: Linked, id: string): number {
  const byId = new Map(queue.items.map((item) => [item.id, item]));
  const measure = (at: string, seen: Set<string>): number => {
    const item = byId.get(at);
    if (!item || seen.has(at)) return 0;
    const next = new Set(seen).add(at);
    let longest = 0;
    for (const ref of item.after) {
      if (ref.kind !== 'item' || !byId.has(ref.id)) continue;
      longest = Math.max(longest, 1 + measure(ref.id, next));
    }
    return Math.min(longest, MAX_DEPTH);
  };
  return measure(id, new Set());
}

/** The predecessors that are not done yet. */
export function unmet(item: Pick<QueueItemView, 'after'>): DependencyView[] {
  return item.after.filter((ref) => ref.state !== 'done');
}

/** The queues of the enabled projects other than `repository`. */
export function otherQueues(
  queues: ReadonlyMap<string, QueueView>,
  repositories: readonly string[],
  repository: string | null,
): QueueView[] {
  return repositories
    .filter((path) => path !== repository)
    .flatMap((path) => queues.get(path) ?? []);
}
