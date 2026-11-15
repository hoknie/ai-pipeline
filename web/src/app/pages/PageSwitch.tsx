import { RunsPage } from '../../features/runs/index.ts';
import { notifyError } from '../../shared/lib/browser/notify.ts';
import { ListRoute, QueueRoute, SettingsRoute, StatsRoute } from './pages.tsx';
import type { PanelData } from '../state/usePanelData.ts';
import type { useRepositoryActions } from '../state/useRepositoryActions.ts';

type RepositoryActions = ReturnType<typeof useRepositoryActions>;

/** What the page of a new task takes from the panel. */
function newTaskPageProps(panel: PanelData) {
  const { state, chrome } = panel;
  return {
    api: panel.api,
    selected: state.selected,
    repositories: state.repositories,
    waiting: panel.waitingRepositories,
    queues: state.queues,
    preset: chrome.newTask.pagePreset,
    onPresetApplied: () => chrome.newTask.setPagePreset(null),
  };
}

/** What the lists of specialists and pipelines need of the mode «All projects»; absent outside it. */
function listProjects(panel: PanelData) {
  if (!panel.allProjects) return undefined;
  return { registry: panel.state.registry, last: panel.state.selected };
}

/** What the queue page needs of the mode «All projects»; absent outside it. */
function allQueuesProps(panel: PanelData, actions: RepositoryActions) {
  if (!panel.allProjects) return undefined;
  return {
    registry: panel.state.registry,
    queues: panel.state.queues,
    onOpenProject: (path: string) => void actions.openProject(path, 'queue'),
  };
}

/** The page of the open section. */
export function PageSwitch({ panel, actions }: { panel: PanelData; actions: RepositoryActions }) {
  const { state, chrome, route, scopedApi } = panel;
  const { runs, queue, selected } = state;
  const common = {
    api: scopedApi,
    runs,
    route,
    onRoute: panel.setRoute,
    pageKey: selected ?? '',
    dirty: chrome.dirty,
  };
  const { queueDrafts, onQueueDraft } = chrome.drafts;
  switch (route.view) {
    case 'queue':
      return (
        <QueueRoute
          common={common}
          queue={queue}
          globalQueue={state.globalQueue}
          registry={state.registry}
          now={chrome.now}
          drafts={queueDrafts}
          onDraft={onQueueDraft}
          onQueue={state.setQueue}
          onError={notifyError}
          onNewTask={chrome.newTask.openNewTask}
          onOpenProject={(path) => void actions.openProject(path, 'queue')}
          allProjects={allQueuesProps(panel, actions)}
          newTaskPage={newTaskPageProps(panel)}
        />
      );
    case 'settings':
      return (
        <SettingsRoute
          common={common}
          streamedObservers={state.streamedObservers}
          streamedNetwork={state.streamedNetwork}
          repository={selected}
          repositories={state.repositories}
          onSelectRepository={(path) => void actions.switchProject(path)}
          registry={state.registry}
          onRegistry={state.setRegistry}
          onProjectMoved={actions.projectMoved}
          onRemoveProject={actions.removeRepository}
          onOpenProject={(path, target) => void actions.openProject(path, target)}
          queue={queue}
          onQueue={state.setQueue}
          onError={notifyError}
        />
      );
    case 'stats':
      return <StatsRoute common={common} registry={state.registry} />;
    case 'pipelines':
    case 'specialists':
      return <ListRoute common={common} allProjects={listProjects(panel)} />;
    default:
      return (
        <RunsPage
          api={panel.api}
          runs={runs}
          loaded={state.loaded}
          openedState={state.openedState}
          route={route}
          now={chrome.now}
          drafts={chrome.drafts.drafts}
          onDraft={chrome.drafts.onDraft}
          onClearDrafts={chrome.drafts.onClearDrafts}
          onError={notifyError}
          onlyReplies={panel.onlyReplies}
          onOnlyReplies={panel.setOnlyReplies}
          onRoute={panel.setRoute}
          repository={selected}
          repositoryPaths={panel.repositoryPaths}
          scope={panel.allProjects ? 'all' : 'repository'}
          onSubtask={queue ? chrome.newTask.openSubtask : undefined}
          history={state.history}
        />
      );
  }
}
