import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Api } from '../api.ts';
import { formatRoute } from '../route.ts';
import type { QueueView, WorkflowsView } from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Skeleton } from '../ui/skeleton.tsx';

import { QueueForm, emptyDraft, type QueueDraft } from './QueueForm.tsx';
import { QueueList, itemLabel } from './QueueList.tsx';
import { QueueRuns } from './QueueRuns.tsx';
import { afterOptions, related } from './queueLinks.ts';
import { parseParallel } from './ParallelStepper.tsx';
import { QueueSettings } from './QueueSettings.tsx';

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
  const [highlight, setHighlight] = useState<string | null>(null);

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

  const chain = highlight === null ? null : related(queue, highlight);
  // a task without links has nothing to light up
  const linked = chain !== null && chain.size > 1 ? chain : null;
  const newDraft = drafts.new ?? emptyDraft();

  return (
    <div className="grid w-full gap-4 p-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <QueueSettings api={api} queue={queue} onQueue={onQueue} onError={onError} />
      <div className="flex min-w-0 flex-col gap-4">
        <StopReason queue={queue} />
        <QueueRuns queue={queue} now={now} highlight={linked} />
        <section aria-label={t('queue.newTaskLabel')}>
          <h3 className="mb-2 font-semibold">{t('queue.newTask')}</h3>
          <QueueForm
            idPrefix="new"
            draft={newDraft}
            workflows={workflows}
            api={api}
            autoDeliverDefault={queue.autoDeliver}
            afterChoices={afterOptions(queue, (item) => itemLabel(item, t))}
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
            highlight={linked}
            onHighlight={setHighlight}
          />
        </section>
      </div>
    </div>
  );
}
