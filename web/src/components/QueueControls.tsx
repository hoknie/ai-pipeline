import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { notifySuccess } from '../notify.ts';
import { queueStateLabel } from '../status.ts';
import type { QueueView } from '../types.ts';
import { Button } from '../ui/button.tsx';

import { ParallelStepper, parseParallel } from './ParallelStepper.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/** The queue state, «Start» and «Pause», and the parallelism; a column beside the content on a wide window. */
export function QueueControls({
  api,
  queue,
  parallel,
  onParallel,
  onQueue,
  onError,
  onDone,
}: {
  api: Api;
  queue: QueueView;
  /** The edited parallelism text; null while it is not being edited. */
  parallel: string | null;
  onParallel: (text: string | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Called after an action succeeded, so the page drops the edited text. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const parsed = parseParallel(parallel ?? String(queue.parallel));
  const invalid = parsed === null;
  const busy =
    queue.status === 'running' || (queue.stop?.kind === 'limit' && queue.stop.autoResume);
  const canStart = queue.status === 'stopped' && (queue.items.length > 0 || queue.runs.length > 0);

  const act = async (work: () => Promise<QueueView>, done: string) => {
    try {
      onQueue(await work());
      onDone();
      notifySuccess(done);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  return (
    <section
      aria-label={t('queue.title')}
      className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-stretch"
    >
      <h2 className="text-lg font-semibold">{t('queue.title')}</h2>
      <div>
        <StatusBadge
          status={queue.status === 'running' ? 'running' : 'stopped'}
          label={queueStateLabel(queue.status, t)}
        />
      </div>
      <ParallelStepper
        api={api}
        queue={queue}
        text={parallel}
        onText={onParallel}
        onQueue={onQueue}
        onError={onError}
      />
      <span className="flex gap-2">
        <Button
          disabled={!canStart || invalid}
          onClick={() =>
            void act(
              () => api.queueStart(parsed !== queue.parallel ? (parsed ?? undefined) : undefined),
              t('queue.started'),
            )
          }
        >
          {t('queue.start')}
        </Button>
        <Button
          variant="outline"
          disabled={!busy}
          onClick={() => void act(() => api.queuePause(), t('queue.paused'))}
        >
          {t('queue.pause')}
        </Button>
      </span>
    </section>
  );
}
