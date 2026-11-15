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
import { statsPeriodOf, type Route } from '../../shared/lib/nav/route.ts';
import { settingsLocationOf } from '../../shared/lib/nav/settingsGroups.ts';

export const NewTaskDialog = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.NewTaskDialog })),
);
const NewTaskPage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.NewTaskPage })),
);
const QueuePage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.QueuePage })),
);
const SpecialistsPage = lazy(() =>
  import('../../features/specialists/index.ts').then((module) => ({
    default: module.SpecialistsPage,
  })),
);
const PipelinesPage = lazy(() =>
  import('../../features/pipelines/index.ts').then((module) => ({ default: module.PipelinesPage })),
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
  onQueue: (queue: QueueView) => void;
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
        onFilter={(period, project) =>
          onRoute({ view: 'stats', run: project, group: period, step: null, tab: null })
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
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { common, ...rest } = props;
  const location = settingsLocationOf(common.route.group, common.route.run);
  const select = (run: string) => (value: string | null) =>
    common.onRoute({ ...to('settings', run, 'global'), step: value });
  return (
    <Suspense fallback={<Loading what={t('app.loadingSettings')} />}>
      <SettingsPage
        key={common.pageKey}
        api={common.api}
        scope={location.scope}
        group={location.group}
        specialist={common.route.step}
        onSelectSpecialist={select('specialists')}
        pipeline={common.route.step}
        onSelectPipeline={select('pipelines')}
        chain={common.route.step}
        onSelectChain={select('chains')}
        project={common.route.step}
        onSelectProject={select('projects')}
        agentTab={common.route.step}
        observerTab={common.route.step}
        onSelectObserverTab={select('observers')}
        dirty={common.dirty}
        {...rest}
      />
    </Suspense>
  );
}

/** What the lists of specialists and pipelines need of the mode «All projects»; absent outside it. */
export type AllProjectsList = { registry: RepositoryView[]; last: string | null };

export function ListRoute({
  common,
  allProjects,
}: {
  common: Common;
  allProjects?: AllProjectsList;
}) {
  const { t } = useTranslation();
  const { route, onRoute } = common;
  if (route.view === 'pipelines')
    return (
      <Suspense fallback={<Loading what="pipeline" />}>
        <PipelinesPage
          key={common.pageKey}
          dirty={common.dirty}
          api={common.api}
          runs={common.runs}
          selected={route.run}
          section={route.group}
          variant={route.step}
          projects={
            allProjects
              ? {
                  registry: allProjects.registry,
                  project: route.project ?? null,
                  last: allProjects.last,
                }
              : undefined
          }
          onSelect={(id, section = null, variant = null, project = null) =>
            onRoute({ ...to('pipelines', id, section), step: variant, project })
          }
          onOpenGroup={(target, step) =>
            onRoute({ ...to('runs', target.runId, target.slug), step })
          }
        />
      </Suspense>
    );
  return (
    <Suspense fallback={<Loading what={t('app.loadingSpecialists')} />}>
      <SpecialistsPage
        key={common.pageKey}
        dirty={common.dirty}
        api={common.api}
        selected={route.run}
        section={route.group}
        projects={
          allProjects
            ? {
                registry: allProjects.registry,
                project: route.project ?? null,
                last: allProjects.last,
              }
            : undefined
        }
        onSelect={(id, section = null, project = null) =>
          common.onRoute({ ...to('specialists', id), group: section, project })
        }
      />
    </Suspense>
  );
}
