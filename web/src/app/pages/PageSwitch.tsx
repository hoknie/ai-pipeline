import { RunsPage } from '../../features/runs/index.ts';
import { notifyError } from '../../shared/lib/browser/notify.ts';
import { ListRoute, QueueRoute, SettingsRoute } from './pages.tsx';
import type { PanelData } from '../state/usePanelData.ts';
import type { useRepositoryActions } from '../state/useRepositoryActions.ts';

type RepositoryActions = ReturnType<typeof useRepositoryActions>;

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
          now={chrome.now}
          drafts={queueDrafts}
          onDraft={onQueueDraft}
          onQueue={state.setQueue}
          onError={notifyError}
          onNewTask={chrome.newTask.openNewTask}
        />
      );
    case 'settings':
      return (
        <SettingsRoute
          common={common}
          streamedObservers={state.streamedObservers}
          repository={selected}
          repositories={state.repositories}
          onSelectRepository={(path) => void actions.selectRepository(path)}
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
    case 'pipelines':
    case 'specialists':
    case 'topology':
      return <ListRoute common={common} />;
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
          scope={panel.scope}
          onScope={panel.setScope}
          onSubtask={queue ? chrome.newTask.openSubtask : undefined}
          history={state.history}
        />
      );
  }
}
