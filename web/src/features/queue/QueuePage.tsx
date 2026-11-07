import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Api } from '../../shared/api/api.ts';
import { clock } from '../../shared/lib/format.ts';
import { takeFocusRequest } from '../../shared/lib/browser/hotkeys.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import type { QueueView, RunView, PipelinesView } from '../../shared/api/types.ts';

import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';

import type { QueueDraft } from './QueueForm.tsx';
import { QueueList } from './QueueList.tsx';
import { QueueRuns } from './QueueRuns.tsx';
import { related } from './queueLinks.ts';
import { parseParallel } from './ParallelStepper.tsx';
import { QueueControls } from './QueueControls.tsx';
import { StopReason } from './cards/StopReason.tsx';

export { parseParallel };

function usePipelines(api: Api): PipelinesView | null {
  const [pipelines, setPipelines] = useState<PipelinesView | null>(null);
  useEffect(() => {
    let closed = false;
    api
      .pipelines()
      .then((view) => {
        if (!closed) setPipelines(view);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [api]);
  return pipelines;
}

export default function QueuePage({
  api,
  queue,
  now,
  drafts,
  onDraft,
  onQueue,
  onError,
  onNewTask,
  runs = [],
}: {
  api: Api;
  queue: QueueView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
  runs?: RunView[];
}) {
  const { t } = useTranslation();
  const pipelines = usePipelines(api);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [parallel, setParallel] = useState<string | null>(null);

  useEffect(() => takeFocusRequest('queue-task', onNewTask), [onNewTask]);

  if (!queue)
    return (
      <div role="status" aria-label={t('queue.loading')} className="p-4">
        <Skeleton className="h-24" />
      </div>
    );

  const chain = highlight === null ? null : related(queue, highlight);
  // a task without links has nothing to light up
  const linked = chain !== null && chain.size > 1 ? chain : null;

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <div className="grid w-full gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <QueueControls
          api={api}
          queue={queue}
          parallel={parallel}
          onParallel={setParallel}
          onQueue={onQueue}
          onError={onError}
          onDone={() => setParallel(null)}
          onNewTask={onNewTask}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <StopReason queue={queue} />
          <QueueRuns
            queue={queue}
            now={now}
            api={api}
            onQueue={onQueue}
            onError={onError}
            highlight={linked}
          />
          <section aria-label={t('queue.waitingLabel')}>
            <h3 className="mb-2 font-semibold">{t('queue.waiting')}</h3>
            <QueueList
              api={api}
              queue={queue}
              runs={runs}
              pipelines={pipelines}
              now={now}
              drafts={drafts}
              onDraft={onDraft}
              onQueue={onQueue}
              highlight={linked}
              onHighlight={setHighlight}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
