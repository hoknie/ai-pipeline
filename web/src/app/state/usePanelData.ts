import { useMemo } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { EventSourceFactory } from '../../shared/api/stream.ts';
import { useRuns } from '../../shared/api/runs/useRuns.ts';
import { notifyError } from '../../shared/lib/browser/notify.ts';
import { usePreference } from '../../shared/lib/browser/preferences.ts';
import { displayPaths, waitingByRepository } from '../../shared/lib/catalog/repositories.ts';
import type { RunScope } from '../../features/runs/index.ts';
import { useNotificationCenter } from '../notifications.ts';
import { useChrome } from './useChrome.ts';
import { useRouteEffects } from './useRouteEffects.ts';
import { useRouteState } from './routeState.ts';

/** What the panel reads: preferences, the route, the stream of runs and the state of the chrome. */
export function usePanelData(api: Api, openStream: EventSourceFactory) {
  const [chosen, setChosen] = usePreference<string | null>('repository', null);
  const [scope, setScope] = usePreference<RunScope>('runs.scope', 'repository');
  const [onlyReplies, setOnlyReplies] = usePreference('onlyReplies', false);
  const { route, setRoute, lastRun } = useRouteState();
  const state = useRuns(
    api,
    openStream,
    chosen,
    route.view === 'runs' ? route.run : null,
    notifyError,
  );
  const { runs, selected, registry } = state;
  const chrome = useChrome(route.view);
  const disabled = useMemo(() => {
    const off = new Set(registry.filter((entry) => !entry.enabled).map((entry) => entry.path));
    return (repository: string) => off.has(repository);
  }, [registry]);
  useRouteEffects(route, runs, selected, setRoute, setChosen, disabled);
  const notifications = useNotificationCenter(
    runs,
    (item) => setRoute({ view: 'runs', run: item.runId, group: item.slug, step: null, tab: null }),
    state.loaded,
    state.listedRuns,
  );
  return {
    api,
    // Every request names its repository, so it never depends on the server's default.
    scopedApi: useMemo(() => api.forRepository(selected), [api, selected]),
    chosen,
    setChosen,
    scope,
    setScope,
    onlyReplies,
    setOnlyReplies,
    route,
    setRoute,
    lastRun,
    state,
    chrome,
    notifications,
    waitingRepositories: useMemo(() => waitingByRepository(registry), [registry]),
    repositoryPaths: useMemo(() => displayPaths(registry), [registry]),
  };
}

export type PanelData = ReturnType<typeof usePanelData>;
