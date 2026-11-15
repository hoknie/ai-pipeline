import type { QueueView, RepositoryView } from '../../../shared/api/types.ts';

export type BulkKind = 'start' | 'pause';

/** A stopped queue that waits for a usage limit to reset and then starts itself. */
function resumesItself(queue: QueueView): boolean {
  return queue.stop?.kind === 'limit' && queue.stop.autoResume;
}

/**
 * The queues of enabled projects a common button acts on: «start» takes a stopped queue with a
 * waiting task that is not postponed (and no wait for a limit to reset), «pause» takes a running
 * one or one that waits for a limit to reset. The order is the one of `queues`.
 */
export function bulkTargets(
  queues: Iterable<QueueView>,
  registry: readonly Pick<RepositoryView, 'path' | 'enabled'>[],
  kind: BulkKind,
): QueueView[] {
  const enabled = new Set(registry.filter((entry) => entry.enabled).map((entry) => entry.path));
  return [...queues].filter((queue) => {
    if (!enabled.has(queue.repository)) return false;
    if (kind === 'pause') return queue.status === 'running' || resumesItself(queue);
    return (
      queue.status === 'stopped' &&
      !resumesItself(queue) &&
      queue.items.some((item) => !item.postponed)
    );
  });
}
