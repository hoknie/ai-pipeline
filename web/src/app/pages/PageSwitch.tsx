import { useTranslation } from 'react-i18next';
import { RunsPage, linkTargets } from '../../features/runs/index.ts';
import { itemLabel, otherQueues } from '../../features/queue/index.ts';
import { notifyError } from '../../shared/lib/browser/notify.ts';
import { ListRoute, QueueRoute, SettingsRoute, StatsRoute } from './pages.tsx';
import type { PanelData } from '../state/usePanelData.ts';
import type { useRepositoryActions } from '../state/useRepositoryActions.ts';
import type { LinkKind } from '../../features/runs/index.ts';
import type { RunView } from '../../shared/api/types.ts';
import type { TFunction } from 'i18next';

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

/** The props of the settings, stats and list routes: the api of the selected project. */
function commonProps(panel: PanelData) {
  return {
    api: panel.scopedApi,
    runs: panel.state.runs,
    route: panel.route,
    onRoute: panel.setRoute,
    pageKey: panel.state.selected ?? '',
    dirty: panel.chrome.dirty,
  };
}

/**
 * The links and subtasks of the runs page: the choices of the run's project and the preset of a
 * child task. Without the queue of the selected project the page adds no links.
 */
function runLinkProps(panel: PanelData, t: TFunction) {
  return {
    onSubtask: panel.state.queue ? panel.chrome.newTask.openSubtask : undefined,
    linkChoices: (run: RunView) => {
      // a project whose queue is not loaded (or has no tasks) still lets a run change its links
      const own = panel.state.queues.get(run.repository) ?? {
        repository: run.repository,
        items: [],
        runs: [],
      };
      return (kind: LinkKind) =>
        linkTargets(
          kind,
          own,
          panel.state.runs,
          (item) => itemLabel(item, t),
          run,
          otherQueues(panel.state.queues, panel.state.repositories, run.repository),
        );
    },
  };
}

/** The page of the open section. */
export function PageSwitch({ panel, actions }: { panel: PanelData; actions: RepositoryActions }) {
  const { t } = useTranslation();
  const { state, chrome, route } = panel;
  const common = commonProps(panel);
  const { queueDrafts, onQueueDraft } = chrome.drafts;
  switch (route.view) {
    case 'queue':
      return (
        <QueueRoute
          common={common}
          queue={state.queue}
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
          repository={state.selected}
          repositories={state.repositories}
          onSelectRepository={(path) => void actions.switchProject(path)}
          registry={state.registry}
          onRegistry={state.setRegistry}
          onProjectMoved={actions.projectMoved}
          onRemoveProject={actions.removeRepository}
          onOpenProject={(path, target) => void actions.openProject(path, target)}
          queue={state.queue}
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
          runs={state.runs}
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
          repository={state.selected}
          repositoryPaths={panel.repositoryPaths}
          scope={panel.allProjects ? 'all' : 'repository'}
          {...runLinkProps(panel, t)}
          onOpenProject={(path) => void actions.openProject(path, 'queue')}
          history={state.history}
        />
      );
  }
}
