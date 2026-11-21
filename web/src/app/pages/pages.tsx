import { lazy, Suspense, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { ObserversView } from '../../shared/api/observerTypes.ts';
import type {
  GlobalQueueView,
  NetworkStatus,
  QueueView,
  RepositoryView,
  RunView,
} from '../../shared/api/types.ts';
import { otherQueues, type QueueDraft } from '../../features/queue/index.ts';
import { Loading } from './Loading.tsx';
import { AllQueuesRoute, GlobalQueueRoute, type AllQueues } from './queueModes.tsx';
import { formatRoute, statsPeriodOf, type Route } from '../../shared/lib/nav/route.ts';
import { settingsLocationOf, swarmTabOf } from '../../shared/lib/nav/settingsGroups.ts';
import {
  routeOfSwarmTarget,
  settingsRouteOfSwarmTarget,
  swarmTargetOfRoute,
  type SwarmTarget,
} from '../../features/swarm/index.ts';

export const NewTaskDialog = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.NewTaskDialog })),
);
const NewTaskPage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.NewTaskPage })),
);
const QueuePage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.QueuePage })),
);
const SwarmWorkspace = lazy(() =>
  import('../../features/swarm/index.ts').then((module) => ({ default: module.SwarmWorkspace })),
);
const StatsPage = lazy(() =>
  import('../../features/stats/index.ts').then((module) => ({ default: module.StatsPage })),
);
const SettingsPage = lazy(() =>
  import('../../features/settings/index.ts').then((module) => ({ default: module.SettingsPage })),
);

const to = (view: Route['view'], run: string | null, group: string | null = null) =>
  ({ view, run, group, step: null, tab: null }) satisfies Route;

export type Common = {
  api: Api;
  runs: RunView[];
  route: Route;
  onRoute: (route: Route) => void;
  pageKey: string;
  dirty: MutableRefObject<boolean>;
};

export function QueueRoute(props: {
  common: Common;
  queue: QueueView | null;
  /** The global queue in the global mode; the page shows it instead of the queue of a project. */
  globalQueue: GlobalQueueView | null;
  /** The projects of the registry. */
  registry: RepositoryView[];
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView | GlobalQueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
  onOpenProject: (path: string) => void;
  /** The mode «All projects»: the queues of every enabled project instead of one. */
  allProjects?: AllQueues;
  /** What the page of a new task needs; the page is shown on `#queue/new`. */
  newTaskPage: {
    api: Api;
    selected: string | null;
    repositories: string[];
    waiting: React.ComponentProps<typeof NewTaskDialog>['waiting'];
    queues: ReadonlyMap<string, QueueView>;
    globalQueue: GlobalQueueView | null;
    preset: { repository: string; parent: string | null } | null;
    onPresetApplied: () => void;
  };
}) {
  const { t } = useTranslation();
  const { common } = props;
  const page = props.newTaskPage;
  if (common.route.run === 'new' && page.selected !== null) {
    return (
      <Suspense fallback={<Loading what={t('app.loadingQueue')} />}>
        <NewTaskPage
          key={common.pageKey}
          api={page.api}
          selected={page.selected}
          repositories={page.repositories}
          waiting={page.waiting}
          queues={page.queues}
          globalQueue={page.globalQueue}
          runs={common.runs}
          preset={page.preset}
          onPresetApplied={page.onPresetApplied}
          draft={props.drafts.new}
          onDraft={(draft) => props.onDraft('new', draft)}
          onQueue={props.onQueue}
          onLeave={() => common.onRoute(to('queue', null))}
        />
      </Suspense>
    );
  }
  if (props.globalQueue) return <GlobalQueueRoute {...props} globalQueue={props.globalQueue} />;
  if (props.allProjects) return <AllQueuesRoute {...props} allProjects={props.allProjects} />;
  return (
    <Suspense fallback={<Loading what={t('app.loadingQueue')} />}>
      <QueuePage
        key={common.pageKey}
        api={common.api}
        queue={props.queue}
        now={props.now}
        drafts={props.drafts}
        onDraft={props.onDraft}
        onQueue={props.onQueue}
        onError={props.onError}
        onNewTask={props.onNewTask}
        runs={common.runs}
        author={common.route.author ?? null}
        onAuthor={(author) => common.onRoute({ ...common.route, author })}
        others={otherQueues(page.queues, page.repositories, props.queue?.repository ?? null)}
        onOpenProject={props.onOpenProject}
      />
    </Suspense>
  );
}

export function StatsRoute({ common, registry }: { common: Common; registry: RepositoryView[] }) {
  const { t } = useTranslation();
  const { route, onRoute } = common;
  return (
    <Suspense fallback={<Loading what={t('app.loadingStats')} />}>
      <StatsPage
        api={common.api}
        registry={registry}
        runs={common.runs}
        period={statsPeriodOf(route.group)}
        project={route.run}
        author={route.author ?? null}
        onFilter={(period, project) =>
          onRoute({
            view: 'stats',
            run: project,
            group: period,
            step: null,
            tab: null,
            ...(route.author ? { author: route.author } : {}),
          })
        }
        onAuthor={(author) =>
          onRoute({
            view: 'stats',
            run: route.run,
            group: statsPeriodOf(route.group),
            step: null,
            tab: null,
            ...(author === null ? {} : { author }),
          })
        }
      />
    </Suspense>
  );
}

export function SettingsRoute(props: {
  common: Common;
  streamedObservers: ObserversView | null;
  streamedNetwork: NetworkStatus | null;
  repository: string | null;
  repositories: string[];
  onSelectRepository: (path: string) => void;
  registry: RepositoryView[];
  onRegistry: (registry: RepositoryView[]) => void;
  onProjectMoved: (from: string, to: string) => void;
  onRemoveProject: (path: string) => Promise<boolean>;
  onOpenProject: (path: string, target: 'settings' | 'queue') => void;
  queue: QueueView | null;
  /** The queue is global: there is no queue of a project to edit. */
  globalQueue?: boolean;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { common, ...rest } = props;
  const location = settingsLocationOf(common.route.group, common.route.run);
  const select = (run: string) => (value: string | null) =>
    common.onRoute({ ...to('settings', run, 'global'), step: value });
  const swarm: SwarmTarget = {
    tab: swarmTabOf(common.route.tab),
    entry: common.route.step,
    section: common.route.section ?? null,
    variant: common.route.variant ?? null,
    preset: common.route.preset ?? null,
  };
  return (
    <Suspense fallback={<Loading what={t('app.loadingSettings')} />}>
      <SettingsPage
        key={common.pageKey}
        api={common.api}
        scope={location.scope}
        group={location.group}
        swarm={swarm}
        onSelectSwarm={(target) =>
          common.onRoute(settingsRouteOfSwarmTarget(location.scope, target))
        }
        runs={common.runs}
        onOpenGroup={(target, step) =>
          common.onRoute({ ...to('runs', target.runId, target.slug), step })
        }
        project={common.route.step}
        onSelectProject={select('projects')}
        runtime={common.route.step}
        onSelectRuntime={select('runtimes')}
        agentTab={common.route.step}
        integrationKind={common.route.tab}
        observerTab={common.route.step}
        onSelectObserverTab={select('observers')}
        dirty={common.dirty}
        {...rest}
      />
    </Suspense>
  );
}

/** What the lists of the window «Swarm» need of the mode «All projects»; absent outside it. */
export type AllProjectsList = { registry: RepositoryView[]; last: string | null };

/** The window «Swarm» of the top bar: the tabs of the selected project (or of all projects). */
export function SwarmRoute({
  common,
  repository,
  allProjects,
  onOpenInProject,
}: {
  common: Common;
  repository: string | null;
  allProjects?: AllProjectsList;
  onOpenInProject?: (path: string, route: Route) => void;
}) {
  const { t } = useTranslation();
  const { route, onRoute } = common;
  const place = swarmTargetOfRoute(route);
  return (
    <Suspense fallback={<Loading what={t('swarm.title')} />}>
      <SwarmWorkspace
        key={common.pageKey}
        api={common.api}
        scope="project"
        place={place}
        repository={repository}
        runs={common.runs}
        dirty={common.dirty}
        projects={allProjects}
        onOpenInProject={
          onOpenInProject
            ? (path, target) =>
                onOpenInProject(path, routeOfSwarmTarget({ ...target, project: null }))
            : undefined
        }
        hrefOf={(target) => formatRoute(routeOfSwarmTarget(target))}
        onNavigate={(target) => onRoute(routeOfSwarmTarget(target))}
        onOpenGroup={(target, step) => onRoute({ ...to('runs', target.runId, target.slug), step })}
      />
    </Suspense>
  );
}
