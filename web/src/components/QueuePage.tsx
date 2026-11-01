import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Api } from '../api.ts';
import { notifySuccess } from '../notify.ts';
import { formatRoute } from '../route.ts';
import { queueStateLabel } from '../status.ts';
import type { QueueView, WorkflowsView } from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Skeleton } from '../ui/skeleton.tsx';

import { StatusBadge } from './StatusBadge.tsx';
import { QueueForm, emptyDraft, type QueueDraft } from './QueueForm.tsx';
import { QueueList } from './QueueList.tsx';
import { QueueRuns } from './QueueRuns.tsx';
import { ParallelStepper, parseParallel } from './ParallelStepper.tsx';

export { parseParallel };

const REASONS = ['needs_human', 'failed', 'conflict', 'cancelled', 'apply_failed'] as const;

function reasonText(reason: string, t: TFunction): string {
  const known = REASONS.find((candidate) => candidate === reason);
  return known ? t(`queue.reasons.${known}`) : reason;
}

function StopReason({ queue }: { queue: QueueView }) {
  const { t } = useTranslation();
  const stop = queue.stop;
  if (!stop) return null;
  if (stop.kind === 'item') {
    return (
      <Alert variant="warn" role="status">
        {t('queue.stopItem', { item: stop.item, error: stop.error })}
      </Alert>
    );
  }
  const route = formatRoute({ view: 'runs', run: stop.run, group: stop.group, step: null });
  return (
    <Alert variant="warn" role="status">
      {t('queue.stopped')} <code>{stop.reason}</code> — {reasonText(stop.reason, t)}.{' '}
      <a className="underline" href={route}>
        {stop.group ? t('queue.openGroup', { group: stop.group }) : t('queue.openRun')}
      </a>
    </Alert>
  );
}

export default function QueuePage({
  api,
  queue,
  now,
  drafts,
  onDraft,
  onQueue,
  onError,
}: {
  api: Api;
  queue: QueueView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<WorkflowsView | null>(null);
  const [parallel, setParallel] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    api
      .workflows()
      .then((view) => {
        if (!closed) setWorkflows(view);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [api]);

  if (!queue)
    return (
      <div role="status" aria-label={t('queue.loading')} className="p-4">
        <Skeleton className="h-24" />
      </div>
    );

  const text = parallel ?? String(queue.parallel);
  const parsed = parseParallel(text);
  const invalid = parsed === null;
  const busy = queue.status === 'running';
  const canStart = queue.status === 'stopped' && (queue.items.length > 0 || queue.runs.length > 0);

  const act = async (work: () => Promise<QueueView>, done: string) => {
    try {
      onQueue(await work());
      setParallel(null);
      notifySuccess(done);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const newDraft = drafts.new ?? emptyDraft();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('queue.title')}</h2>
        <StatusBadge
          status={queue.status === 'running' ? 'running' : 'stopped'}
          label={queueStateLabel(queue.status, t)}
        />
        <ParallelStepper
          api={api}
          queue={queue}
          text={parallel}
          onText={setParallel}
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
      </header>
      <StopReason queue={queue} />
      <QueueRuns queue={queue} now={now} />
      <section aria-label={t('queue.newTaskLabel')}>
        <h3 className="mb-2 font-semibold">{t('queue.newTask')}</h3>
        <QueueForm
          idPrefix="new"
          draft={newDraft}
          workflows={workflows}
          autoDeliverDefault={queue.autoDeliver}
          submitLabel={t('queue.add')}
          onDraft={(draft) => onDraft('new', draft)}
          onSubmit={async (fields) => {
            const view = await api.queueAdd(fields);
            onQueue(view);
            onDraft('new', emptyDraft(fields.workflow));
          }}
        />
      </section>
      <section aria-label={t('queue.waitingLabel')}>
        <h3 className="mb-2 font-semibold">{t('queue.waiting')}</h3>
        <QueueList
          api={api}
          queue={queue}
          workflows={workflows}
          now={now}
          drafts={drafts}
          onDraft={onDraft}
          onQueue={onQueue}
        />
      </section>
    </div>
  );
}
