import { useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueView } from '../../../shared/api/types.ts';

type Lists = { pipelines: string[]; tags: string[] };

/**
 * The take filter of the queue: a change shows at once and waits for the daemon; a failure
 * puts the old value back and goes to the page.
 */
export function useTakeFilter(
  api: Api,
  queue: QueueView,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const [pending, setPending] = useState<Partial<Lists> | null>(null);
  const shown: Lists = {
    pipelines: pending?.pipelines ?? queue.filter.pipelines,
    tags: pending?.tags ?? queue.filter.tags,
  };
  /** `patch` holds tag ids (as the view does); `tagNames` turns them into the names the daemon takes. */
  const change = async (patch: Partial<Lists>, tagNames?: (ids: string[]) => string[]) => {
    setPending(patch);
    const sent = patch.tags && tagNames ? { ...patch, tags: tagNames(patch.tags) } : patch;
    try {
      onQueue(await api.queueSettings({ filter: sent }));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending(null);
    }
  };
  return { shown, change, saving: pending !== null };
}
