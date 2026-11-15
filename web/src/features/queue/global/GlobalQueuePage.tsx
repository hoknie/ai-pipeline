import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { GlobalQueueView, RepositoryView } from '../../../shared/api/types.ts';
import { QueueControls } from '../QueueControls.tsx';
import { StopReason } from '../cards/StopReason.tsx';
import { GlobalItems } from './GlobalItems.tsx';
import { GlobalRuns } from './GlobalRuns.tsx';
import { ProjectsFilter } from './ProjectsFilter.tsx';
import { asQueue } from './asQueue.ts';

/** The one queue of the global mode: the tasks and runs of all projects in one order. */
export default function GlobalQueuePage({
  api,
  queue,
  projects,
  now,
  onNewTask,
  onError,
}: {
  api: Api;
  queue: GlobalQueueView;
  /** The enabled projects of the registry. */
  projects: readonly RepositoryView[];
  now: number;
  onNewTask: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [parallel, setParallel] = useState<string | null>(null);
  const shape = asQueue(queue);
  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-primary px-2.5 py-0.5 text-sm font-medium">
          {t('queue.global.badge')}
        </span>
        <span className="text-sm text-muted-foreground">
          {t('queue.global.max', { count: queue.max })}
        </span>
      </div>
      <div className="grid w-full gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <ProjectsFilter api={api} queue={queue} projects={projects} onError={onError} />
          <QueueControls
            api={api}
            queue={shape}
            parallel={parallel}
            onParallel={setParallel}
            onQueue={() => undefined}
            onError={onError}
            onDone={() => setParallel(null)}
            onNewTask={onNewTask}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <StopReason queue={shape} />
          <GlobalRuns queue={queue} now={now} />
          <section aria-label={t('queue.waitingLabel')}>
            <h3 className="mb-2 font-semibold">{t('queue.waiting')}</h3>
            <GlobalItems api={api} items={queue.items} onError={onError} />
          </section>
        </div>
      </div>
    </div>
  );
}
