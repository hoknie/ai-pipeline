import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from './api.ts';
import type { QueueDraft } from './components/QueueForm.tsx';
import { navRunCounts, runsOf, type RunScope } from './components/runs/runFilter.ts';
import { RunsPage } from './components/runs/RunsPage.tsx';
import { AppShell } from './components/shell/AppShell.tsx';
import { CommandPalette } from './components/shell/CommandPalette.tsx';
import { DaemonBanner } from './components/shell/DaemonBanner.tsx';
import { StatusBar } from './components/shell/StatusBar.tsx';
import { ShortcutsDialog } from './components/shell/ShortcutsDialog.tsx';
import { ConfirmProvider, useConfirm } from './confirm.tsx';
import { useHotkey } from './hotkeys.ts';
import { notifyError } from './notify.ts';
import { useNotificationCenter } from './notifications.ts';
import { usePreference } from './preferences.ts';
import { formatRoute, parseRoute, type Route, type View } from './route.ts';
import { displayPaths, repositoryLabel, waitingByRepository } from './repositories.ts';
import { sectionLabel } from './sections.ts';
import { settingsLocationOf } from './settingsGroups.ts';
import { browserEventSource, useRuns, type EventSourceFactory } from './store.ts';
import { TagsProvider } from './tags.tsx';
import type { RunView } from './types.ts';
import { Skeleton } from './ui/skeleton.tsx';

const TopologyPage = lazy(() => import('./components/TopologyPage.tsx'));
const NewTaskDialog = lazy(() => import('./components/NewTaskDialog.tsx'));
const QueuePage = lazy(() => import('./components/QueuePage.tsx'));
const SpecialistsPage = lazy(() => import('./components/SpecialistsPage.tsx'));
const WorkflowsPage = lazy(() => import('./components/WorkflowsPage.tsx'));
const SettingsPage = lazy(() => import('./components/settings/SettingsPage.tsx'));

function readRoute(): Route {
  return parseRoute(window.location.hash);
}

function writeRoute(route: Route): void {
  const hash = formatRoute(route);
  if (window.location.hash !== hash)
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Loading({ what }: { what: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('app.loading', { what })} className="flex flex-col gap-2 p-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40" />
    </div>
  );
}

/** The panel: the confirmation dialog wraps it, so a repository switch can ask first. */
export function App(props: { api: Api; openStream?: EventSourceFactory }) {
  return (
    <ConfirmProvider>
      <Panel {...props} />
    </ConfirmProvider>
  );
}

function Panel({
  api,
  openStream = browserEventSource,
}: {
  api: Api;
  openStream?: EventSourceFactory;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [chosen, setChosen] = usePreference<string | null>('repository', null);
  const [scope, setScope] = usePreference<RunScope>('runs.scope', 'repository');
  const [route, setRoute] = useState<Route>(readRoute);
  const {
    runs,
    connection,
    loaded,
    home,
    repositories,
    registry,
    setRegistry,
    selected,
    queue,
    queues,
    setQueue,
    tags,
    setTags,
    daemon,
    openedState,
    streamedProcesses,
    history,
  } = useRuns(api, openStream, chosen, route.view === 'runs' ? route.run : null, notifyError);
  // Every request names its repository, so it never depends on the server's default.
  const scopedApi = useMemo(() => api.forRepository(selected), [api, selected]);
  const pageKey = selected ?? '';
  /** Whether the open specialist or workflow form has unsaved edits. */
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = false;
  }, [route.view]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queueDrafts, setQueueDrafts] = useState<Record<string, QueueDraft>>({});
  const [onlyReplies, setOnlyReplies] = usePreference('onlyReplies', false);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [newTaskOpened, setNewTaskOpened] = useState(false);
  const [newTaskPreset, setNewTaskPreset] = useState<{
    repository: string;
    parent: string;
  } | null>(null);
  const openNewTask = useCallback(() => {
    setNewTaskPreset(null);
    setNewTaskOpened(true);
    setNewTask(true);
  }, []);
  const openSubtask = useCallback((run: RunView) => {
    setNewTaskPreset({ repository: run.repository, parent: run.id });
    setNewTaskOpened(true);
    setNewTask(true);
  }, []);
  const lastRun = useRef<string | null>(null);
  const now = useNow();

  useHotkey('mod+k', (event) => {
    event.preventDefault();
    setPalette((open) => !open);
  });
  useHotkey('?', () => setShortcuts(true));

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => writeRoute(route), [route]);
  useEffect(() => {
    if (route.view === 'runs' && route.run) lastRun.current = route.run;
  }, [route]);

  const first = runs.find((candidate) => candidate.repository === selected);
  useEffect(() => {
    if (route.view === 'runs' && route.run === null && first)
      setRoute((current) => ({ ...current, run: first.id }));
  }, [route.view, route.run, first]);

  // An address or a link that opens a run of another repository selects that repository.
  const routedRepository =
    route.view === 'runs' && route.run
      ? (runs.find((candidate) => candidate.id === route.run)?.repository ?? null)
      : null;
  useEffect(() => {
    if (routedRepository !== null && routedRepository !== selected) setChosen(routedRepository);
  }, [routedRepository, selected, setChosen]);

  const notifications = useNotificationCenter(
    runs,
    (item) => setRoute({ view: 'runs', run: item.runId, group: item.slug, step: null, tab: null }),
    loaded,
  );

  const onDraft = useCallback((key: string, text: string) => {
    setDrafts((current) => ({ ...current, [key]: text }));
  }, []);
  const onClearDrafts = useCallback((prefix: string) => {
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}/`)),
      ),
    );
  }, []);
  const onQueueDraft = useCallback((key: string, draft: QueueDraft | null) => {
    setQueueDrafts((current) => {
      if (draft !== null) return { ...current, [key]: draft };
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }, []);
  const onError = useCallback((message: string) => notifyError(message), []);

  const run =
    route.view === 'runs' ? (runs.find((candidate) => candidate.id === route.run) ?? null) : null;
  const tabRoute = (view: View): Route => {
    if (view === route.view) return route;
    if (view === 'queue' || view === 'specialists' || view === 'workflows')
      return { view, run: null, group: null, step: null, tab: null };
    if (view === 'settings')
      return { view, run: 'general', group: 'global', step: null, tab: null };
    if (view === 'topology')
      return { view, run: run?.workflow ?? null, group: null, step: null, tab: null };
    return { view, run: lastRun.current, group: null, step: null, tab: null };
  };
  const { working, waiting } = navRunCounts(runsOf(runs, scope === 'repository' ? selected : null));
  const waitingRepositories = useMemo(() => waitingByRepository(registry), [registry]);
  const repositoryPaths = useMemo(() => displayPaths(registry), [registry]);
  const selectRepository = async (path: string) => {
    if (path === selected) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    dirty.current = false;
    lastRun.current = null;
    setChosen(path);
    // A run of the previous repository cannot stay open: the list is about to show another.
    if (route.view === 'runs')
      setRoute({ view: 'runs', run: null, group: null, step: null, tab: null });
  };

  const addRepository = async (path: string) => {
    const list = await api.addRepository(path);
    setRegistry(list);
    // The daemon answers with the list only; the new entry is the root that contains the path.
    const known = new Set(registry.map((entry) => entry.path));
    const root =
      list
        .filter((entry) => path === entry.path || path.startsWith(`${entry.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]?.path ??
      list.find((entry) => !known.has(entry.path))?.path;
    if (root) await selectRepository(root);
  };
  const latest = useRef({ chosen, selected });
  latest.current = { chosen, selected };
  const removeRepository = async (path: string) => {
    const name = repositoryLabel(path);
    if (
      !(await confirm({
        title: t('nav.repositoryRemoveTitle', { name }),
        description: t('nav.repositoryRemoveDescription'),
        confirmLabel: t('nav.repositoryRemove'),
        destructive: true,
      }))
    )
      return;
    try {
      setRegistry(await api.removeRepository(path));
    } catch (error) {
      notifyError(error);
      return;
    }
    if (path === latest.current.selected || path === latest.current.chosen) {
      dirty.current = false;
      lastRun.current = null;
      setChosen(null);
      if (route.view === 'runs')
        setRoute({ view: 'runs', run: null, group: null, step: null, tab: null });
    }
  };

  return (
    <TagsProvider tags={tags} onTags={setTags}>
      <AppShell
        footer={
          <StatusBar
            runs={runs}
            selected={selected}
            connection={connection}
            streamedProcesses={streamedProcesses}
            api={api}
            onOpenGroup={(entry) =>
              setRoute({
                view: 'runs',
                run: entry.runId,
                group: entry.group,
                step: entry.step,
                tab: null,
              })
            }
          />
        }
        nav={{
          view: route.view,
          hrefFor: (view) => formatRoute(tabRoute(view)),
          onNavigate: (view) => {
            if (view === 'topology' && run && run.repository !== selected)
              setChosen(run.repository);
            setRoute(tabRoute(view));
          },
          repository: {
            repositories,
            paths: repositoryPaths,
            selected,
            waiting: waitingRepositories,
            home,
            onSelect: (path) => void selectRepository(path),
            onAdd: addRepository,
            onRemove: (path) => void removeRepository(path),
          },
          working,
          waiting,
          queued: queue?.items.length ?? 0,
          onPalette: () => setPalette(true),
          onNewTask: queue ? openNewTask : undefined,
          notifications,
        }}
      >
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          api={scopedApi}
          runs={runs}
          route={route}
          onRoute={setRoute}
          onShortcuts={() => setShortcuts(true)}
        />
        {queue !== null && selected !== null && newTaskOpened ? (
          <Suspense fallback={null}>
            <NewTaskDialog
              key={pageKey}
              api={api}
              selected={selected}
              repositories={repositories}
              waiting={waitingRepositories}
              queues={queues}
              runs={runs}
              preset={newTaskPreset}
              onPresetApplied={() => setNewTaskPreset(null)}
              open={newTask}
              onOpenChange={setNewTask}
              draft={queueDrafts.new}
              onDraft={(draft) => onQueueDraft('new', draft)}
              onQueue={setQueue}
            />
          </Suspense>
        ) : null}
        <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
        <DaemonBanner daemon={daemon} />
        <h1 className="sr-only">{sectionLabel(route.view, t)}</h1>
        {route.view === 'queue' ? (
          <Suspense fallback={<Loading what={t('app.loadingQueue')} />}>
            <QueuePage
              key={pageKey}
              api={scopedApi}
              queue={queue}
              now={now}
              drafts={queueDrafts}
              onDraft={onQueueDraft}
              onQueue={setQueue}
              onError={onError}
              onNewTask={openNewTask}
              runs={runs}
            />
          </Suspense>
        ) : route.view === 'settings' ? (
          <Suspense fallback={<Loading what={t('app.loadingSettings')} />}>
            <SettingsPage
              key={pageKey}
              api={scopedApi}
              scope={settingsLocationOf(route.group, route.run).scope}
              group={settingsLocationOf(route.group, route.run).group}
              specialist={route.step}
              onSelectSpecialist={(slug) =>
                setRoute({
                  view: 'settings',
                  run: 'specialists',
                  group: 'global',
                  step: slug,
                  tab: null,
                })
              }
              workflow={route.step}
              onSelectWorkflow={(id) =>
                setRoute({
                  view: 'settings',
                  run: 'pipelines',
                  group: 'global',
                  step: id,
                  tab: null,
                })
              }
              repository={selected}
              repositories={repositories}
              onSelectRepository={(path) => void selectRepository(path)}
              dirty={dirty}
              queue={queue}
              onQueue={setQueue}
              onError={onError}
            />
          </Suspense>
        ) : route.view === 'workflows' ? (
          <Suspense fallback={<Loading what="workflow" />}>
            <WorkflowsPage
              key={pageKey}
              dirty={dirty}
              api={scopedApi}
              runs={runs}
              selected={route.run}
              onSelect={(id) =>
                setRoute({ view: 'workflows', run: id, group: null, step: null, tab: null })
              }
            />
          </Suspense>
        ) : route.view === 'specialists' ? (
          <Suspense fallback={<Loading what={t('app.loadingSpecialists')} />}>
            <SpecialistsPage
              key={pageKey}
              dirty={dirty}
              api={scopedApi}
              selected={route.run}
              onSelect={(id) =>
                setRoute({ view: 'specialists', run: id, group: null, step: null, tab: null })
              }
            />
          </Suspense>
        ) : route.view === 'topology' ? (
          <Suspense fallback={<Loading what={t('app.loadingGraph')} />}>
            <TopologyPage
              key={pageKey}
              api={scopedApi}
              runs={runs}
              workflow={route.run}
              onSelectWorkflow={(id) =>
                setRoute({ view: 'topology', run: id, group: null, step: null, tab: null })
              }
              onEditWorkflow={(id) =>
                setRoute({ view: 'workflows', run: id, group: null, step: null, tab: null })
              }
              onOpenGroup={(target, step) =>
                setRoute({ view: 'runs', run: target.runId, group: target.slug, step, tab: null })
              }
            />
          </Suspense>
        ) : (
          <RunsPage
            api={api}
            runs={runs}
            loaded={loaded}
            openedState={openedState}
            route={route}
            now={now}
            drafts={drafts}
            onDraft={onDraft}
            onClearDrafts={onClearDrafts}
            onError={onError}
            onlyReplies={onlyReplies}
            onOnlyReplies={setOnlyReplies}
            onRoute={setRoute}
            repository={selected}
            repositoryPaths={repositoryPaths}
            scope={scope}
            onScope={setScope}
            onSubtask={queue ? openSubtask : undefined}
            history={history}
          />
        )}
      </AppShell>
    </TagsProvider>
  );
}
