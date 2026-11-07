import { useEffect, useMemo } from 'react';

import type { Api } from '../api.ts';
import { repositoryList } from '../../lib/catalog/repositories.ts';
import type { QueueView } from '../types.ts';
import { putQueue } from './runsState.ts';
import type { RunsSetters } from './streamEvents.ts';
import type { RunsState } from './useRunsStore.ts';

/** The chosen repository and its queue; a queue the daemon has not sent yet is asked for. */
export function useSelection(
  api: Api,
  { home, registry, queues }: RunsState,
  setQueues: RunsSetters['setQueues'],
  wanted: string | null,
): { repositories: string[]; selected: string | null; queue: QueueView | null } {
  const repositories = useMemo(() => repositoryList(home, registry), [home, registry]);
  const selected = wanted !== null && repositories.includes(wanted) ? wanted : home;
  const queue = selected ? (queues.get(selected) ?? null) : null;
  // The daemon answers with an empty queue for a repository that has none yet.
  const missing = selected !== null && selected !== home && queue === null;
  useEffect(() => {
    if (!missing || selected === null) return;
    let closed = false;
    api
      .forRepository(selected)
      .queue()
      .then((view) => {
        if (!closed) setQueues((current) => putQueue(current, view));
      })
      .catch(() => {
        // the queue stays unknown; the page shows its own loading state
      });
    return () => {
      closed = true;
    };
  }, [api, missing, selected, setQueues]);
  return { repositories, selected, queue };
}
