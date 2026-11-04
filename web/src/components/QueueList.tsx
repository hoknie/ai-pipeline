import { Ban, CircleCheck, Clock, GripVertical, ListOrdered } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { cn } from '../lib/cn.ts';
import { notifySuccess } from '../notify.ts';
import { taskNumber, when } from '../format.ts';
import { useLocale } from '../i18n/index.ts';
import { formatRoute } from '../route.ts';
import type {
  DependencyState,
  ItemReadiness,
  QueueItemView,
  QueueView,
  WorkflowsView,
} from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Badge, badgeVariants } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Switch } from '../ui/switch.tsx';

import { TagChips } from './TagChip.tsx';
import { WorkflowBadge } from './WorkflowBadge.tsx';
import { QueueForm, draftOf, type QueueDraft } from './QueueForm.tsx';
import { dropPosition, dropSlot, moveId } from './queueOrder.ts';
import { afterOptions, dependents, depth, unmet } from './queueLinks.ts';

const STATE_ICON = { done: CircleCheck, waiting: Clock, blocked: Ban } as const;
const STATE_TONE = { done: 'ok', waiting: 'warn', blocked: 'err' } as const;

/** The icon and the tone of a predecessor state or a readiness; `ready` looks like `done`. */
function stateLook(state: DependencyState | ItemReadiness) {
  const key = state === 'ready' ? 'done' : state;
  return { Icon: STATE_ICON[key], tone: STATE_TONE[key] };
}

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
  highlight = null,
  onHighlight = () => undefined,
}: {
  api: Api;
  queue: QueueView;
  workflows: WorkflowsView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  /** Ids to mark as linked to the item under the pointer or the focus; null for none. */
  highlight?: Set<string> | null;
  /** The item under the pointer or the focus, null when there is none. */
  onHighlight?: (id: string | null) => void;
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
  // the shown state of the switches while their request is on its way
  const [pending, setPending] = useState<Record<string, boolean>>({});

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
    const waiting = dependents(queue, item.id);
    const yes = await confirm({
      title: t('queue.list.removeTitle', { item: itemLabel(item, t) }),
      ...(waiting.length > 0
        ? {
            description: t('queue.list.removeDependents', {
              items: waiting.map((other) => itemLabel(other, t)).join(', '),
            }),
          }
        : {}),
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
    if (item.readiness !== 'ready') {
      const yes = await confirm({
        title: t('queue.list.unmetTitle'),
        description: t('queue.list.unmetText', {
          items: unmet(item)
            .map((ref) => ref.title || ref.id)
            .join(', '),
        }),
        confirmLabel: t('queue.list.runNow'),
        cancelLabel: t('queue.list.keep'),
      });
      if (!yes) return;
    }
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

  const setPostponed = async (item: QueueItemView, postponed: boolean) => {
    setPending((current) => ({ ...current, [item.id]: postponed }));
    setMessage(null);
    try {
      onQueue(await api.queueEdit(item.id, { postponed }));
    } catch (failure) {
      setMessage((failure as Error).message);
      void refresh();
    } finally {
      setPending((current) => {
        const { [item.id]: _shown, ...rest } = current;
        return rest;
      });
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
          const level = depth(queue, item.id);
          const postponed = pending[item.id] ?? item.postponed === true;
          const linked = dragging === null && highlight?.has(item.id) === true;
          return (
            <li
              key={item.id}
              className={cn(
                'rounded-lg border bg-card p-2.5',
                level > 0 && 'border-l-4 border-l-primary/50',
                item.readiness === 'blocked' && 'border-destructive',
                linked && 'ring-2 ring-primary',
                dragging === item.id && 'opacity-50',
                postponed && 'opacity-60',
                drop?.index === index &&
                  (drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
              )}
              data-id={item.id}
              data-depth={level}
              data-highlighted={linked ? '' : undefined}
              style={level > 0 ? { marginLeft: `${level * 1.25}rem` } : undefined}
              tabIndex={0}
              onMouseEnter={() => dragging === null && onHighlight(item.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => dragging === null && onHighlight(item.id)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  onHighlight(null);
              }}
              draggable={!editing}
              aria-label={`${index + 1}. ${itemLabel(item, t)}`}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
                onHighlight(null);
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
                <span className="font-mono text-xs text-muted-foreground">
                  {taskNumber(item.number)}
                </span>
                <WorkflowBadge id={item.workflow} />
                <span className="min-w-0 flex-1 truncate" title={itemLabel(item, t)}>
                  {itemLabel(item, t)}
                </span>
                <TagChips tags={item.tags ?? []} />
                {item.run !== null ? (
                  <a
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-primary underline"
                    title={t('queue.returnOf', { run: item.run })}
                    href={formatRoute({ view: 'runs', run: item.run, group: null, step: null })}
                  >
                    {t('queue.returning')}
                  </a>
                ) : null}
                <Switch
                  checked={!postponed}
                  aria-label={t('queue.list.active')}
                  title={t('queue.list.activeHint')}
                  onCheckedChange={(active) => void setPostponed(item, !active)}
                />
                {postponed ? (
                  <Badge variant="warn" title={t('queue.list.activeHint')}>
                    {t('queue.list.postponed')}
                  </Badge>
                ) : null}
                <ReadinessBadge item={item} />
                {item.after.map((ref) => (
                  <DependencyChip key={ref.id} dependency={ref} />
                ))}
                {linked ? <span className="sr-only">{t('queue.list.linked')}</span> : null}
                {item.autoDeliver === null ? null : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {item.autoDeliver
                      ? t('queue.list.autoDelivery')
                      : t('queue.list.manualDelivery')}
                  </span>
                )}
                {item.deliveryMode === null || item.deliveryMode === undefined ? null : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t('queue.list.deliveryMode', { mode: t(`deliveryMode.${item.deliveryMode}`) })}
                  </span>
                )}
                {item.skip && item.skip.length > 0 ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t('queue.list.skips', {
                      steps: item.skip
                        .map(
                          (id) =>
                            workflows?.workflows
                              .find((candidate) => candidate.id === item.workflow)
                              ?.steps.find((step) => step.id === id)?.name ?? id,
                        )
                        .join(', '),
                    })}
                  </span>
                ) : null}
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
                  api={api}
                  autoDeliverDefault={queue.autoDeliver}
                  deliveryModeDefault={queue.deliveryMode}
                  afterChoices={afterOptions(queue, (other) => itemLabel(other, t), item)}
                  locked={item.run !== null}
                  submitLabel={t('queue.list.save')}
                  onDraft={(draft) => onDraft(`edit:${item.id}`, draft)}
                  onCancel={() => onDraft(`edit:${item.id}`, null)}
                  onSubmit={async (fields) => {
                    try {
                      const view = await api.queueEdit(
                        item.id,
                        item.run !== null
                          ? { ...(fields.after !== undefined ? { after: fields.after } : {}) }
                          : {
                              workflow: fields.workflow,
                              ...(fields.task !== undefined ? { task: fields.task } : {}),
                              ...(fields.groups !== undefined ? { groups: fields.groups } : {}),
                              title: fields.title ?? null,
                              autoDeliver: fields.autoDeliver ?? null,
                              deliveryMode: fields.deliveryMode ?? null,
                              tags: fields.tags ?? [],
                              skip: fields.skip ?? [],
                              ...(fields.after !== undefined ? { after: fields.after } : {}),
                            },
                      );
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

function ReadinessBadge({ item }: { item: QueueItemView }) {
  const { t } = useTranslation();
  const { Icon, tone } = stateLook(item.readiness);
  const label = t(`queue.readiness.${item.readiness}`);
  const pending = unmet(item)
    .map((ref) => ref.title || ref.id)
    .join(', ');
  const title =
    pending !== ''
      ? `${label} (${item.readiness}): ${pending}`
      : item.readiness === 'ready'
        ? `${label} (${item.readiness}): ${t('queue.list.readyHint')}`
        : `${label} (${item.readiness})`;
  return (
    <Badge variant={tone} title={title} aria-label={title} data-readiness={item.readiness}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

function DependencyChip({ dependency }: { dependency: QueueItemView['after'][number] }) {
  const { t } = useTranslation();
  const { Icon, tone } = stateLook(dependency.state);
  const name = dependency.title || dependency.id;
  const state = t(`queue.dependency.${dependency.state}`);
  const body = (
    <>
      <Icon aria-hidden />
      <span className="min-w-0 truncate">
        {dependency.number !== null ? (
          <span className="font-mono">{taskNumber(dependency.number)} </span>
        ) : null}
        {t('queue.list.after', { title: name })}
      </span>
      <span className="sr-only">{state}</span>
    </>
  );
  return dependency.kind === 'run' ? (
    <a
      className={cn(badgeVariants({ variant: tone }), 'underline')}
      title={`${state}: ${name}`}
      data-state={dependency.state}
      href={formatRoute({ view: 'runs', run: dependency.id, group: null, step: null })}
    >
      {body}
    </a>
  ) : (
    <Badge variant={tone} title={`${state}: ${name}`} data-state={dependency.state}>
      {body}
    </Badge>
  );
}
