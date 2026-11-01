import { GripVertical, ListOrdered } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { cn } from '../lib/cn.ts';
import { notifySuccess } from '../notify.ts';
import { when } from '../format.ts';
import { useLocale } from '../i18n/index.ts';
import { formatRoute } from '../route.ts';
import type { QueueItemView, QueueView, WorkflowsView } from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';

import { QueueForm, draftOf, type QueueDraft } from './QueueForm.tsx';
import { dropPosition, dropSlot, moveId } from './queueOrder.ts';

/** `N groups` with the plural of the active language. */
export function groupsText(count: number, t: TFunction): string {
  return t('queue.list.groups', { count });
}

export function itemLabel(item: QueueItemView, t: TFunction): string {
  if (item.title) return item.title;
  if (item.groups) return groupsText(item.groups.length, t);
  return (
    (item.task ?? '')
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}

type Drop = { index: number; after: boolean } | null;

export function QueueList({
  api,
  queue,
  workflows,
  now,
  drafts,
  onDraft,
  onQueue,
}: {
  api: Api;
  queue: QueueView;
  workflows: WorkflowsView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const confirm = useConfirm();
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [started, setStarted] = useState<{ item: string; runId: string } | null>(null);
  const inFlight = useRef(false);

  // a new queue (an event, another client) is the truth, except while our own move is on its way
  useEffect(() => {
    if (!inFlight.current) setOrder(null);
  }, [queue.items]);

  const byId = new Map(queue.items.map((item) => [item.id, item]));
  const shown = (order ?? queue.items.map((item) => item.id))
    .map((id) => byId.get(id))
    .filter((item): item is QueueItemView => item !== undefined);
  for (const item of queue.items) if (!shown.includes(item)) shown.push(item);

  const refresh = async () => {
    try {
      onQueue(await api.queue());
    } catch {
      // the next event brings the queue
    }
  };

  const move = async (id: string, position: number) => {
    const ids = shown.map((item) => item.id);
    const from = ids.indexOf(id);
    if (from === -1 || position < 1 || position > ids.length || position - 1 === from) return;
    setOrder(moveId(ids, from, position));
    setMessage(null);
    inFlight.current = true;
    try {
      onQueue(await api.queueEdit(id, { position }));
    } catch (failure) {
      setMessage(t('queue.list.moveFailed', { error: (failure as Error).message }));
      void refresh();
    } finally {
      inFlight.current = false;
      setOrder(null);
    }
  };

  const remove = async (item: QueueItemView) => {
    const yes = await confirm({
      title: t('queue.list.removeTitle', { item: itemLabel(item, t) }),
      confirmLabel: t('queue.list.remove'),
      cancelLabel: t('queue.list.keep'),
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    try {
      onQueue(await api.queueRemove(item.id));
      onDraft(`edit:${item.id}`, null);
      notifySuccess(t('queue.list.removed'));
    } catch (failure) {
      setMessage((failure as Error).message);
      void refresh();
    }
  };

  const runNow = async (item: QueueItemView) => {
    setMessage(null);
    try {
      const created = await api.queueRunNow(item.id);
      setStarted({ item: item.id, runId: created.runId });
      notifySuccess(t('queue.list.runStarted'));
      onDraft(`edit:${item.id}`, null);
      await refresh();
    } catch (failure) {
      setMessage((failure as Error).message);
      void refresh();
    }
  };

  const onDragOver = (event: React.DragEvent<HTMLLIElement>, index: number) => {
    if (dragging === null) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    setDrop((current) =>
      current?.index === index && current.after === after ? current : { index, after },
    );
  };

  const onDrop = (event: React.DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    const id = dragging ?? event.dataTransfer.getData('text/plain');
    const box = event.currentTarget.getBoundingClientRect();
    const slot = dropSlot([box.top + box.height / 2], event.clientY) + index;
    const from = shown.findIndex((item) => item.id === id);
    setDragging(null);
    setDrop(null);
    if (from === -1) return;
    const position = dropPosition(from, slot);
    if (position !== null) void move(id, position);
  };

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLLIElement>,
    item: QueueItemView,
    at: number,
  ) => {
    if (!event.altKey || event.target !== event.currentTarget) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      void move(item.id, at);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      void move(item.id, at + 2);
    }
  };

  if (shown.length === 0) {
    return (
      <>
        <Empty icon={<ListOrdered />} title={t('queue.list.empty')}>
          {t('queue.list.emptyHint')}
        </Empty>
        {message ? <Alert variant="destructive">{message}</Alert> : null}
      </>
    );
  }

  return (
    <>
      {message ? <Alert variant="destructive">{message}</Alert> : null}
      <ol className="flex flex-col gap-2" aria-label={t('queue.list.items')}>
        {shown.map((item, index) => {
          const editing = drafts[`edit:${item.id}`];
          return (
            <li
              key={item.id}
              className={cn(
                'rounded-lg border bg-card p-2.5',
                dragging === item.id && 'opacity-50',
                drop?.index === index &&
                  (drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
              )}
              data-id={item.id}
              tabIndex={0}
              draggable={!editing}
              aria-label={`${index + 1}. ${itemLabel(item, t)}`}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragging(item.id);
              }}
              onDragOver={(event) => onDragOver(event, index)}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => {
                setDragging(null);
                setDrop(null);
              }}
              onKeyDown={(event) => onKeyDown(event, item, index)}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <GripVertical
                  className="size-4 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                >
                  <title>{t('queue.list.drag')}</title>
                </GripVertical>
                <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {item.workflow}
                </span>
                <span className="min-w-0 flex-1 truncate" title={itemLabel(item, t)}>
                  {itemLabel(item, t)}
                </span>
                {item.autoDeliver === null ? null : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {item.autoDeliver
                      ? t('queue.list.autoDelivery')
                      : t('queue.list.manualDelivery')}
                  </span>
                )}
                {item.title && item.groups ? (
                  <span className="text-muted-foreground">{groupsText(item.groups.length, t)}</span>
                ) : null}
                <time
                  className="text-xs text-muted-foreground tabular-nums"
                  dateTime={new Date(item.createdAt).toISOString()}
                  title={t('queue.list.addedAt', {
                    when: new Date(item.createdAt).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                >
                  {when(item.createdAt, now, locale)}
                </time>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDraft(`edit:${item.id}`, editing ? null : draftOf(item))}
                  >
                    {editing ? t('queue.list.cancel') : t('queue.list.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(item)}>
                    {t('queue.list.remove')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={
                      queue.runs.length >= queue.parallel
                        ? t('queue.list.runNowOverflow', {
                            taken: queue.runs.length + 1,
                            count: queue.parallel,
                          })
                        : undefined
                    }
                    onClick={() => void runNow(item)}
                  >
                    {t('queue.list.runNow')}
                  </Button>
                </span>
              </div>
              {item.error ? (
                <Alert variant="destructive" className="mt-2">
                  {t('queue.list.startFailed', { error: item.error })}
                </Alert>
              ) : null}
              {started?.item === item.id ? (
                <p className="mt-2 text-sm">
                  {t('queue.list.startedRun')}{' '}
                  <a
                    className="text-primary underline"
                    href={formatRoute({
                      view: 'runs',
                      run: started.runId,
                      group: null,
                      step: null,
                    })}
                  >
                    {t('queue.list.run', { id: started.runId })}
                  </a>
                </p>
              ) : null}
              {editing ? (
                <QueueForm
                  idPrefix={`edit-${item.id}`}
                  draft={editing}
                  workflows={workflows}
                  autoDeliverDefault={queue.autoDeliver}
                  submitLabel={t('queue.list.save')}
                  onDraft={(draft) => onDraft(`edit:${item.id}`, draft)}
                  onCancel={() => onDraft(`edit:${item.id}`, null)}
                  onSubmit={async (fields) => {
                    try {
                      const view = await api.queueEdit(item.id, {
                        workflow: fields.workflow,
                        ...(fields.task !== undefined ? { task: fields.task } : {}),
                        ...(fields.groups !== undefined ? { groups: fields.groups } : {}),
                        title: fields.title ?? null,
                        autoDeliver: fields.autoDeliver ?? null,
                      });
                      onQueue(view);
                      onDraft(`edit:${item.id}`, null);
                    } catch (failure) {
                      if (/unknown queue item/.test((failure as Error).message)) {
                        // the item became a run: the form goes away with it, so the error stays here
                        setMessage((failure as Error).message);
                        void refresh();
                      }
                      throw failure;
                    }
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
