import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import type { GlobalQueueView, QueueView, RepositoryView } from '../../shared/api/types.ts';
import type { QueueDraft } from '../../features/queue/index.ts';
import { Loading } from './Loading.tsx';
import type { Common } from './pages.tsx';

const AllQueuesPage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({ default: module.AllQueuesPage })),
);
const GlobalQueuePage = lazy(() =>
  import('../../features/queue/index.ts').then((module) => ({
    default: module.GlobalQueuePage,
  })),
);

export type QueueRouteProps = {
  common: Common;
  queue: QueueView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView | GlobalQueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
};
export type AllQueues = {
  registry: RepositoryView[];
  queues: ReadonlyMap<string, QueueView>;
  onOpenProject: (path: string) => void;
};

/** The queue section in the mode «All projects»: the queues of every enabled project. */
export function AllQueuesRoute(props: QueueRouteProps & { allProjects: AllQueues }) {
  const { t } = useTranslation();
  const { common, allProjects } = props;
  return (
    <Suspense fallback={<Loading what={t('app.loadingQueue')} />}>
      <AllQueuesPage
        api={common.api}
        registry={allProjects.registry}
        queues={allProjects.queues}
        runs={common.runs}
        now={props.now}
        drafts={props.drafts}
        onDraft={props.onDraft}
        onQueue={props.onQueue}
        onError={props.onError}
        onNewTask={props.onNewTask}
        onOpenProject={allProjects.onOpenProject}
      />
    </Suspense>
  );
}

/** The queue section in the global mode: one queue over every enabled project. */
export function GlobalQueueRoute(
  props: QueueRouteProps & { globalQueue: GlobalQueueView; registry: RepositoryView[] },
) {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<Loading what={t('app.loadingQueue')} />}>
      <GlobalQueuePage
        api={props.common.api}
        queue={props.globalQueue}
        projects={props.registry.filter((entry) => entry.enabled !== false)}
        runs={props.common.runs}
        now={props.now}
        drafts={props.drafts}
        onDraft={props.onDraft}
        onQueue={props.onQueue}
        onNewTask={props.onNewTask}
        onError={props.onError}
      />
    </Suspense>
  );
}
