import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Api } from '../api.ts';
import { clock } from '../format.ts';
import { takeFocusRequest } from '../hotkeys.ts';
import { formatRoute } from '../route.ts';
import type { QueueView, WorkflowsView } from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';
import { Skeleton } from '../ui/skeleton.tsx';

import { QueueForm, emptyDraft, type QueueDraft } from './QueueForm.tsx';
import { QueueList, itemLabel } from './QueueList.tsx';
import { QueueRuns } from './QueueRuns.tsx';
import { afterOptions, related } from './queueLinks.ts';
import { parseParallel } from './ParallelStepper.tsx';
import { QueueControls } from './QueueControls.tsx';

export { parseParallel };

const REASONS = [
  'needs_human',
  'failed',
  'conflict',
  'cancelled',
  'apply_failed',
  'usage_limit',
] as const;

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
  if (stop.kind === 'limit') {
    return (
      <Alert variant="warn" role="status">
        {t('queue.stopped')} {t('queue.limitStop', { runtime: stop.runtime })},{' '}
        {t('queue.limitResets', { time: clock(stop.resetsAt) })}.{' '}
        {stop.autoResume ? `${t('queue.limitResumes', { time: clock(stop.resetsAt) })} ` : null}
        <a className="underline" href={route}>
          {t('queue.openGroup', { group: stop.group })}
        </a>
      </Alert>
    );
  }
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
  const [open, setOpen] = useState(false);
  const [parallel, setParallel] = useState<string | null>(null);
  const mode = useRef<'task' | 'groups'>('task');
  mode.current = (drafts.new ?? emptyDraft()).mode;

  useEffect(() => takeFocusRequest('queue-task', () => setOpen(true)), []);

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
    <div className="flex w-full flex-col gap-4 p-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-none content-start md:max-h-[90vh] md:w-[75vw]"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const field = mode.current === 'task' ? '#new-task' : '#new-group-0-title';
            document.querySelector<HTMLElement>(field)?.focus();
          }}
        >
          <DialogTitle>{t('queue.newTask')}</DialogTitle>
          <QueueForm
            idPrefix="new"
            draft={newDraft}
            workflows={workflows}
            api={api}
            autoDeliverDefault={queue.autoDeliver}
            deliveryModeDefault={queue.deliveryMode}
            afterChoices={afterOptions(queue, (item) => itemLabel(item, t))}
            submitLabel={t('queue.add')}
            onDraft={(draft) => onDraft('new', draft)}
            onSubmit={async (fields) => {
              const view = await api.queueAdd(fields);
              onQueue(view);
              onDraft('new', emptyDraft(fields.workflow));
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <div className="grid w-full gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <QueueControls
          api={api}
          queue={queue}
          parallel={parallel}
          onParallel={setParallel}
          onQueue={onQueue}
          onError={onError}
          onDone={() => setParallel(null)}
          onNewTask={() => setOpen(true)}
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
    </div>
  );
}
