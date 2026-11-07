import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import { queueStateLabel } from '../../shared/lib/status.ts';
import type { QueueView } from '../../shared/api/types.ts';
import { Button } from '../../shared/ui/forms/button.tsx';

import { ParallelStepper, parseParallel } from './ParallelStepper.tsx';
import { StatusBadge } from '../../shared/ui/feedback/StatusBadge.tsx';

function StartPause({
  api,
  queue,
  parsed,
  onQueue,
  onError,
  onDone,
}: {
  api: Api;
  queue: QueueView;
  parsed: number | null;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
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
    <span className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        disabled={!canStart || parsed === null}
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
  );
}

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
      <StartPause
        api={api}
        queue={queue}
        parsed={parsed}
        onQueue={onQueue}
        onError={onError}
        onDone={onDone}
      />
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
