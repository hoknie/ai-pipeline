import { Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useState, type ReactNode } from 'react';

import type { Api } from '../api.ts';
import { clock, cost, duration, taskNumber, usageText } from '../format.ts';
import { waitText } from '../status.ts';
import { notifySuccess } from '../notify.ts';
import { cn } from '../lib/cn.ts';
import { formatRoute } from '../route.ts';
import type { QueueRunView, QueueView } from '../types.ts';

import { useConfirm } from '../confirm.tsx';
import { Button } from '../ui/button.tsx';
import { Badge } from '../ui/badge.tsx';
import { Card } from '../ui/card.tsx';

import { StatusBadge } from './StatusBadge.tsx';
import { TagChips } from './TagChip.tsx';
import { WorkflowBadge } from './WorkflowBadge.tsx';

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

function RunCard({
  run,
  now,
  linked,
  action = null,
}: {
  run: QueueRunView;
  now: number;
  linked: boolean;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const { total } = run.groups;
  const { steps } = run;
  const caption =
    total > 1
      ? t('queue.groupsSteps', {
          done: run.groups.done,
          count: total,
          steps: steps.done,
          total: steps.total,
        })
      : steps.current
        ? t('queue.stepOf', {
            number: steps.current.number,
            count: steps.total,
            step: steps.current.name ?? steps.current.step,
          })
        : t('queue.stepsAll', { count: steps.total });
  const problem = run.problem;
  return (
    <Card
      role="group"
      aria-label={run.title}
      data-highlighted={linked ? '' : undefined}
      className={cn('flex min-w-0 flex-col gap-2 p-3 text-sm', linked && 'ring-2 ring-primary')}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {taskNumber(run.number)}
        </span>
        <a
          className="min-w-0 truncate font-medium text-primary underline"
          title={run.title}
          href={formatRoute({ view: 'runs', run: run.id, group: null, step: null })}
        >
          {run.title}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.state} />
        <WorkflowBadge id={run.workflow} />
        <TagChips tags={run.tags ?? []} />
        {run.priority ? (
          <Badge variant="run" title={t('queue.priorityHint')}>
            {t('queue.priority')}
          </Badge>
        ) : null}
        {run.delivering ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Truck aria-hidden className="size-4" />
            {t('queue.delivering')}
          </span>
        ) : null}
      </div>
      {run.system.length > 0 || run.delivery ? (
        <div className="flex flex-wrap items-center gap-2" aria-label={t('runs.system.stages')}>
          {run.system.map((step) => (
            <span key={step.kind} className="inline-flex items-center gap-1 text-muted-foreground">
              {t(`runs.system.${step.kind}`)}
              <StatusBadge status={step.status} />
            </span>
          ))}
          {run.delivery ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {t('runs.system.delivery')}
              <StatusBadge status={run.delivery === 'delivering' ? 'running' : run.delivery} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
        <span>{t('format.running', { duration: duration(now - run.createdAt) })}</span>
        {usageText(run.usage) ? <span>{usageText(run.usage)}</span> : null}
        {cost(run.usage) ? <span>{cost(run.usage)}</span> : null}
        {run.limitUntil !== null ? (
          <span className="text-status-warn">
            {t('runs.group.limitUntil', { time: clock(run.limitUntil) })}
          </span>
        ) : null}
      </div>
      {total === 0 ? (
        <span className="text-muted-foreground">{t('queue.splitting')}</span>
      ) : (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={t('queue.progress')}
            aria-valuemin={0}
            aria-valuenow={steps.done}
            aria-valuemax={steps.total}
            className="h-1.5 w-full overflow-hidden rounded bg-muted"
          >
            <div
              className="h-full bg-primary"
              style={{ width: `${steps.total === 0 ? 0 : (steps.done / steps.total) * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground">{caption}</span>
        </div>
      )}
      {run.active.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {run.active.map((active) => (
            <li key={active.group}>
              {groupLabel(active.group, t)}
              {(active.stepName ?? active.step) ? <> · {active.stepName ?? active.step}</> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {run.waiting.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {run.waiting.map((held) => (
            <li key={held.group} className="flex flex-wrap items-center gap-1">
              {groupLabel(held.group, t)}
              {(held.stepName ?? held.step) ? <> · {held.stepName ?? held.step}</> : null}
              <StatusBadge status="waiting" wait={held.wait} />
              <span>{waitText(held.wait, t)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <div className="text-destructive">
          <code>{problem.reason}</code> — {reasonText(problem.reason, t)}.{' '}
          <a
            className="underline"
            href={formatRoute({ view: 'runs', run: run.id, group: problem.group, step: null })}
          >
            {problem.group ? t('queue.openGroup', { group: problem.group }) : t('queue.openRun')}
          </a>
        </div>
      ) : null}
      {action ? <div>{action}</div> : null}
    </Card>
  );
}

/** Runs taken off the places by a stopping problem; they do not count as places taken. */
function SkippedRuns({
  queue,
  now,
  api,
  onQueue,
  onError,
}: {
  queue: QueueView;
  now: number;
  api: Api;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [returning, setReturning] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const putBack = async (run: string) => {
    setReturning(run);
    try {
      onQueue(await api.queueReturn(run, queue.repository));
      notifySuccess(t('queue.returned'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setReturning(null);
    }
  };
  const dismiss = async (run: QueueRunView) => {
    const yes = await confirm({
      title: t('queue.dismissTitle', { run: run.title }),
      description: t('queue.dismissDescription'),
      confirmLabel: t('queue.dismissRun'),
      cancelLabel: t('queue.list.keep'),
      destructive: true,
    });
    if (!yes) return;
    setDismissing(run.id);
    try {
      onQueue(await api.queueDismiss(run.id, queue.repository));
      notifySuccess(t('queue.dismissed'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setDismissing(null);
    }
  };
  const busy = returning !== null || dismissing !== null;
  return (
    <section aria-label={t('queue.skippedLabel')}>
      <h3 className="mb-2 font-semibold">{t('queue.skipped', { count: queue.skipped.length })}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {queue.skipped.map((run) => (
          <li key={run.id} className="min-w-0">
            <RunCard
              run={run}
              now={now}
              linked={false}
              action={
                <div className="flex flex-wrap gap-2">
                  {run.returnable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={returning === run.id}
                      disabled={busy}
                      onClick={() => void putBack(run.id)}
                    >
                      {t('queue.returnRun')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={dismissing === run.id}
                    disabled={busy}
                    onClick={() => void dismiss(run)}
                  >
                    {t('queue.dismissRun')}
                  </Button>
                </div>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Runs of the queue that hold a place, as cards, with the free places of a running queue. */
/** A group slug; the slug of a system step (`_split`, `_message`, `_resolve`) becomes its name. */
function groupLabel(slug: string, t: TFunction) {
  const kind = /^_(split|message|resolve)$/.exec(slug)?.[1] as
    'split' | 'message' | 'resolve' | undefined;
  return kind ? <span>{t(`runs.system.${kind}`)}</span> : <code>{slug}</code>;
}

export function QueueRuns({
  queue,
  now,
  api,
  onQueue,
  onError,
  highlight = null,
}: {
  queue: QueueView;
  now: number;
  api: Api;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Ids linked to the item under the pointer or the focus. */
  highlight?: Set<string> | null;
}) {
  const { t } = useTranslation();
  const running = queue.status === 'running';
  const [pausing, setPausing] = useState<string | null>(null);
  const pause = async (run: string) => {
    setPausing(run);
    try {
      onQueue(await api.pauseRun(run, queue.repository));
      notifySuccess(t('queue.runPaused'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPausing(null);
    }
  };
  const skipped =
    queue.skipped.length > 0 ? (
      <SkippedRuns queue={queue} now={now} api={api} onQueue={onQueue} onError={onError} />
    ) : null;
  if (queue.runs.length === 0 && !running) return skipped;
  const free = running ? Math.max(0, queue.parallel - queue.runs.length) : 0;
  return (
    <>
      <section aria-label={t('queue.runningLabel')}>
        <h3 className="mb-2 font-semibold">
          {t('queue.running')} ·{' '}
          {t('queue.runsPlaces', { taken: queue.runs.length, count: queue.parallel })}
        </h3>
        {queue.runs.length > queue.parallel ? (
          <p className="mb-2 text-sm text-muted-foreground">{t('queue.runsOverflow')}</p>
        ) : null}
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {queue.runs.map((run) => (
            <li key={run.id} className="min-w-0">
              <RunCard
                run={run}
                now={now}
                linked={highlight?.has(run.id) === true}
                action={
                  run.delivering || run.state === 'finished' || run.state === 'cancelled' ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pausing === run.id}
                      disabled={pausing !== null}
                      onClick={() => void pause(run.id)}
                    >
                      {t('queue.pauseRun')}
                    </Button>
                  )
                }
              />
            </li>
          ))}
          {Array.from({ length: free }, (_, index) => (
            <li
              key={`free-${index}`}
              className="flex items-center justify-center rounded-xl border border-dashed p-3 text-sm text-muted-foreground"
            >
              {t('queue.freeSlot')}
            </li>
          ))}
        </ul>
      </section>
      {skipped}
    </>
  );
}
