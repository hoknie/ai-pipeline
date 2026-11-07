import { lazy, Suspense, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { ObserversView } from '../../shared/api/observerTypes.ts';
import type { QueueView, RunView } from '../../shared/api/types.ts';
import type { QueueDraft } from '../../features/queue/index.ts';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import type { Route } from '../../shared/lib/nav/route.ts';
import { settingsLocationOf } from '../../shared/lib/nav/settingsGroups.ts';

const TopologyPage = lazy(() =>
  import('../../features/topology/index.ts').then((module) => ({ default: module.TopologyPage })),
);
export const NewTaskDialog = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.NewTaskDialog })),
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
const SettingsPage = lazy(() =>
  import('../../features/settings/index.ts').then((module) => ({ default: module.SettingsPage })),
);

export function Loading({ what }: { what: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('app.loading', { what })} className="flex flex-col gap-2 p-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40" />
    </div>
  );
}

const to = (view: Route['view'], run: string | null, group: string | null = null) =>
  ({ view, run, group, step: null, tab: null }) satisfies Route;

type Common = {
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
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
}) {
  const { t } = useTranslation();
  const { common } = props;
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
      />
    </Suspense>
  );
}

export function SettingsRoute(props: {
  common: Common;
  streamedObservers: ObserversView | null;
  repository: string | null;
  repositories: string[];
  onSelectRepository: (path: string) => void;
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
        observerTab={common.route.step}
        onSelectObserverTab={select('observers')}
        dirty={common.dirty}
        {...rest}
      />
    </Suspense>
  );
}

export function ListRoute({ common }: { common: Common }) {
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
          scope={route.step}
          onSelect={(id, section = null, level = null) =>
            onRoute({ ...to('pipelines', id, section), step: level })
          }
        />
      </Suspense>
    );
  if (route.view === 'specialists')
    return (
      <Suspense fallback={<Loading what={t('app.loadingSpecialists')} />}>
        <SpecialistsPage
          key={common.pageKey}
          dirty={common.dirty}
          api={common.api}
          selected={route.run}
          onSelect={(id) => onRoute(to('specialists', id))}
        />
      </Suspense>
    );
  return (
    <Suspense fallback={<Loading what={t('app.loadingGraph')} />}>
      <TopologyPage
        key={common.pageKey}
        api={common.api}
        runs={common.runs}
        pipeline={route.run}
        onSelectPipeline={(id) => onRoute(to('topology', id))}
        onEditPipeline={(id) => onRoute(to('pipelines', id))}
        onOpenGroup={(target, step) => onRoute({ ...to('runs', target.runId, target.slug), step })}
      />
    </Suspense>
  );
}
