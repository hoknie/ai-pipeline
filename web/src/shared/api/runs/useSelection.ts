import { useEffect, useMemo } from 'react';

import type { Api } from '../api.ts';
import { latestEnabled, rememberProjects, repositoryList } from '../../lib/catalog/repositories.ts';
import type { QueueView } from '../types.ts';
import { putQueue } from './runsState.ts';
import type { RunsSetters } from './streamEvents.ts';
import type { RunsState } from './useRunsStore.ts';

/** The chosen repository and its queue; a queue the daemon has not sent yet is asked for. */
export function useSelection(
  api: Api,
  { home, registry, queues, globalQueue }: RunsState,
  setQueues: RunsSetters['setQueues'],
  wanted: string | null,
): { repositories: string[]; selected: string | null; queue: QueueView | null } {
  const repositories = useMemo(() => {
    // every place naming a project reads its name and color from here
    rememberProjects(registry);
    return repositoryList(home, registry);
  }, [home, registry]);
  // The home repository is the server's default; a disabled one gives way to the latest enabled.
  // The global mode has no home repository: the latest enabled project stands in for it.
  const fallback =
    home === null
      ? globalQueue !== null
        ? latestEnabled(registry)
        : null
      : repositories.includes(home)
        ? home
        : (latestEnabled(registry) ?? home);
  const selected = wanted !== null && repositories.includes(wanted) ? wanted : fallback;
  const queue = selected ? (queues.get(selected) ?? null) : null;
  // The daemon answers with an empty queue for a repository that has none yet.
  const missing = selected !== null && selected !== home && queue === null && globalQueue === null;
  useEffect(() => {
    if (!missing || selected === null) return;
    let closed = false;
    api
      .forRepository(selected)
      .queue()
      .then((view) => {
        // the global mode answers with the global queue, which the stream carries
        if (!closed && (view as { scope?: string }).scope !== 'global') {
          setQueues((current) => putQueue(current, view));
        }
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
