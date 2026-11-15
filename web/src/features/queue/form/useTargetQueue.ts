import { useEffect, useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { GlobalQueueView, QueueView } from '../../../shared/api/types.ts';
import { lineOf } from '../global/asQueue.ts';

/**
 * The queues the form reads by project: those of the snapshot, or in the global mode the line of
 * every project in the global queue.
 */
export function useTargetQueues(
  queues: ReadonlyMap<string, QueueView>,
  globalQueue: GlobalQueueView | null,
  repositories: readonly string[],
): ReadonlyMap<string, QueueView> {
  return useMemo(
    () =>
      globalQueue === null
        ? queues
        : new Map(repositories.map((path) => [path, lineOf(globalQueue, path)])),
    [queues, globalQueue, repositories],
  );
}

/** A repository without a queue in the snapshot: load it once. */
export function useTargetQueue(
  scoped: Api,
  queueKnown: boolean,
  onQueue: (queue: QueueView | GlobalQueueView) => void,
): void {
  useEffect(() => {
    if (queueKnown) return;
    let closed = false;
    scoped
      .queue()
      .then((view) => {
        if (!closed) onQueue(view);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [scoped, queueKnown, onQueue]);
}
