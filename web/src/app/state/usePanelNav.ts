import { navRunCounts, runsOf } from '../../features/runs/index.ts';
import { formatRoute, type Route, type View } from '../../shared/lib/nav/route.ts';
import type { NavProps } from '../shell/nav/NavSidebar.tsx';
import type { PanelData } from './usePanelData.ts';
import type { useRepositoryActions } from './useRepositoryActions.ts';
import { tabRoute } from './tabRoute.ts';

/** The properties of the navigation strip: tabs, counters and the repository menu. */
export function usePanelNav(panel: PanelData, actions: RepositoryActions): NavProps {
  const { route, setRoute, scope, chrome, setChosen } = panel;
  const { runs, selected, queue } = panel.state;
  const run =
    route.view === 'runs' ? (runs.find((candidate) => candidate.id === route.run) ?? null) : null;
  const { working, waiting } = navRunCounts(runsOf(runs, scope === 'repository' ? selected : null));
  return {
    view: route.view,
    hrefFor: (view: View) => formatRoute(tabRoute(view, route, run, panel.lastRun.current)),
    onNavigate: (view: View) => {
      if (view === 'topology' && run && run.repository !== selected) setChosen(run.repository);
      setRoute(tabRoute(view, route, run, panel.lastRun.current));
    },
    repository: {
      repositories: panel.state.repositories,
      paths: panel.repositoryPaths,
      selected,
      waiting: panel.waitingRepositories,
      home: panel.state.home,
      onSelect: (path) => void actions.selectRepository(path),
      onAdd: actions.addRepository,
      onRemove: (path) => void actions.removeRepository(path),
    },
    working,
    waiting,
    queued: queue?.items.length ?? 0,
    onPalette: () => chrome.setPalette(true),
    onNewTask: queue ? chrome.newTask.openNewTask : undefined,
    notifications: panel.notifications,
  };
}

type RepositoryActions = ReturnType<typeof useRepositoryActions>;
