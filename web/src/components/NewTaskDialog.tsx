import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { taskNumber } from '../format.ts';
import { notifySuccess } from '../notify.ts';
import type { QueueView, WorkflowsView } from '../types.ts';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';

import { QueueForm, emptyDraft, type QueueDraft } from './QueueForm.tsx';
import { itemLabel } from './QueueList.tsx';
import { afterOptions } from './queueLinks.ts';

/** The one dialog of a new task: opened from the top strip, the queue page and the palette. */
export default function NewTaskDialog({
  api,
  queue,
  open,
  onOpenChange,
  draft,
  onDraft,
  onQueue,
}: {
  api: Api;
  queue: QueueView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
}) {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<WorkflowsView | null>(null);
  const current = draft ?? emptyDraft();
  const mode = useRef<'task' | 'groups'>('task');
  mode.current = current.mode;

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          draft={current}
          workflows={workflows}
          api={api}
          autoDeliverDefault={queue.autoDeliver}
          deliveryModeDefault={queue.deliveryMode}
          afterChoices={afterOptions(queue, (item) => itemLabel(item, t))}
          submitLabel={t('queue.add')}
          onDraft={onDraft}
          onSubmit={async (fields) => {
            const view = await api.queueAdd(fields);
            onQueue(view);
            onDraft(emptyDraft(fields.workflow));
            onOpenChange(false);
            const number = view.items.find((item) => item.id === view.item)?.number;
            notifySuccess(
              number === undefined
                ? t('queue.createdNoNumber')
                : t('queue.created', { number: taskNumber(number) }),
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
