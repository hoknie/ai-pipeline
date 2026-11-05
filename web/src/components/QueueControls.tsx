import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { notifySuccess } from '../notify.ts';
import { formatRoute } from '../route.ts';
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
  onNewTask,
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
  onNewTask: () => void;
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
      aria-label={t('queue.controls.label')}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="font-semibold">{t('queue.controls.title')}</h3>
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
      <div>
        <Button onClick={onNewTask}>
          <Plus className="size-4" aria-hidden="true" />
          {t('queue.newTask')}
        </Button>
      </div>
      <span className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
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
      <a
        className="text-sm underline"
        href={formatRoute({
          view: 'settings',
          run: 'queue',
          group: 'project',
          step: null,
          tab: null,
        })}
      >
        {t('queue.controls.settings')}
      </a>
    </section>
  );
}
