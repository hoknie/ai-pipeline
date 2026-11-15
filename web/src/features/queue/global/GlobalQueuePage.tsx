import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  GlobalQueueView,
  PipelinesView,
  QueueView,
  RepositoryView,
  RunView,
} from '../../../shared/api/types.ts';
import type { QueueDraft } from '../QueueForm.tsx';
import { QueueControls } from '../QueueControls.tsx';
import { QueueList } from '../QueueList.tsx';
import { QueueRuns } from '../QueueRuns.tsx';
import { related } from '../list/links.tsx';
import { StopReason } from '../cards/StopReason.tsx';
import { QueueLinksContext } from '../list/links.tsx';
import { GlobalTakeFilter } from './GlobalTakeFilter.tsx';
import { asQueue, lineOf, globalScope, repositoryOf } from './asQueue.ts';
import { useProjectPipelines, useProjectTags } from './useProjectPipelines.ts';

/** The badge of the global queue and its limit of specialists. */
function GlobalHeader({ max }: { max: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="rounded-full border border-primary px-2.5 py-0.5 text-sm font-medium">
        {t('queue.global.badge')}
      </span>
      <span className="text-sm text-muted-foreground">{t('queue.global.max', { count: max })}</span>
    </div>
  );
}

type SideProps = {
  api: Api;
  queue: GlobalQueueView;
  projects: readonly RepositoryView[];
  pipelines: ReadonlyMap<string, PipelinesView>;
  onQueue: (queue: QueueView | GlobalQueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
};

function useHighlight(queue: QueueView) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const chain = highlight === null ? null : related(queue, highlight);
  return { linked: chain !== null && chain.size > 1 ? chain : null, setHighlight };
}

/** The left column: the take filter above the queue controls. */
function GlobalSide({ api, queue, projects, pipelines, onQueue, onError, onNewTask }: SideProps) {
  const [parallel, setParallel] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <GlobalTakeFilter
        api={api}
        queue={queue}
        projects={projects}
        pipelines={pipelines}
        onQueue={onQueue}
        onError={onError}
      />
      <QueueControls
        api={api}
        queue={asQueue(queue)}
        parallel={parallel}
        onParallel={setParallel}
        onQueue={onQueue}
        onError={onError}
        onDone={() => setParallel(null)}
        onNewTask={onNewTask}
      />
    </div>
  );
}

/** The one queue of the global mode: the tasks and runs of all projects in one order. */
export default function GlobalQueuePage({
  api,
  queue,
  projects,
  runs = [],
  now,
  drafts = {},
  onDraft = () => undefined,
  onQueue,
  onNewTask,
  onError,
}: {
  api: Api;
  queue: GlobalQueueView;
  /** The enabled projects of the registry. */
  projects: readonly RepositoryView[];
  /** All runs of the panel: the parent choices of a task come from them. */
  runs?: RunView[];
  now: number;
  drafts?: Record<string, QueueDraft>;
  onDraft?: (key: string, draft: QueueDraft | null) => void;
  /** Takes the answer of the daemon to an action: in the global mode the global queue. */
  onQueue: (queue: QueueView | GlobalQueueView) => void;
  onNewTask: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const shape = useMemo(() => asQueue(queue), [queue]);
  const { linked, setHighlight } = useHighlight(shape);
  const paths = useMemo(() => projects.map((entry) => entry.path), [projects]);
  const pipelines = useProjectPipelines(api, paths);
  useProjectTags(api, paths);
  const lines = useMemo(() => paths.map((path) => lineOf(queue, path)), [paths, queue]);
  const scope = globalScope(api, queue, pipelines, runs);
  const runRepository = (run: { id: string }) => repositoryOf(queue, run.id);
  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <GlobalHeader max={queue.max} />
      <div className="grid w-full gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <GlobalSide
          api={api}
          queue={queue}
          projects={projects}
          pipelines={pipelines}
          onQueue={onQueue}
          onError={onError}
          onNewTask={onNewTask}
        />
        <QueueLinksContext value={{ others: lines }}>
          <div className="flex min-w-0 flex-col gap-4">
            <StopReason queue={shape} />
            <QueueRuns
              queue={shape}
              now={now}
              api={api}
              onQueue={onQueue}
              onError={onError}
              highlight={linked}
              repositoryOf={runRepository}
              projectOf={runRepository}
            />
            <section aria-label={t('queue.waitingLabel')}>
              <h3 className="mb-2 font-semibold">{t('queue.waiting')}</h3>
              <QueueList
                api={api}
                queue={shape}
                runs={runs}
                pipelines={null}
                now={now}
                drafts={drafts}
                onDraft={onDraft}
                onQueue={onQueue}
                scope={scope}
                highlight={linked}
                onHighlight={setHighlight}
              />
            </section>
          </div>
        </QueueLinksContext>
      </div>
    </div>
  );
}
