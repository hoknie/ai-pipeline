import { navRunCounts, runsOf } from '../../features/runs/index.ts';
import { requestFocus } from '../../shared/lib/browser/hotkeys.ts';
import { formatRoute, type Route, type View } from '../../shared/lib/nav/route.ts';
import type { NavProps } from '../shell/nav/NavSidebar.tsx';
import type { PanelData } from './usePanelData.ts';
import type { useRepositoryActions } from './useRepositoryActions.ts';
import { tabRoute } from './tabRoute.ts';

/** The properties of the navigation strip: tabs, counters and the repository menu. */
export function usePanelNav(panel: PanelData, actions: RepositoryActions): NavProps {
  const { route, setRoute, allProjects, chrome } = panel;
  const { runs, selected, queue } = panel.state;
  const { working, waiting } = navRunCounts(runsOf(runs, allProjects ? null : selected));
  return {
    view: route.view,
    hrefFor: (view: View) => formatRoute(tabRoute(view, route, panel.lastRun.current)),
    onNavigate: (view: View) => {
      setRoute(tabRoute(view, route, panel.lastRun.current));
    },
    repository: {
      repositories: panel.state.repositories,
      paths: panel.repositoryPaths,
      selected,
      allProjects,
      onAllProjects: () => void actions.selectAllProjects(),
      waiting: panel.waitingRepositories,
      onSelect: (path) => void actions.selectRepository(path),
      onAdd: actions.addRepository,
      browse: panel.api.directories,
    },
    working,
    waiting,
    queued:
      panel.state.globalQueue?.items.length ??
      (allProjects ? queuedInProjects(panel) : (queue?.items.length ?? 0)),
    onPalette: () => chrome.setPalette(true),
    // on the page of a new task the button moves the focus to its form instead of opening the dialog
    onNewTask:
      queue || panel.state.globalQueue
        ? route.view === 'queue' && route.run === 'new'
          ? () => requestFocus('new-task-page')
          : chrome.newTask.openNewTask
        : undefined,
    notifications: panel.notifications,
  };
}

type RepositoryActions = ReturnType<typeof useRepositoryActions>;

/** The tasks waiting in the queues of every enabled project. */
function queuedInProjects(panel: PanelData): number {
  const enabled = new Set(panel.state.repositories);
  let sum = 0;
  for (const [repository, view] of panel.state.queues) {
    if (enabled.has(repository)) sum += view.items.length;
  }
  return sum;
}
