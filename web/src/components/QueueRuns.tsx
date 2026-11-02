import { Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { duration } from '../format.ts';
import { cn } from '../lib/cn.ts';
import { formatRoute } from '../route.ts';
import type { QueueRunView, QueueView } from '../types.ts';

import { Card } from '../ui/card.tsx';

import { StatusBadge } from './StatusBadge.tsx';
import { TagChips } from './TagChip.tsx';

const REASONS = ['needs_human', 'failed', 'conflict', 'cancelled', 'apply_failed'] as const;

function reasonText(reason: string, t: TFunction): string {
  const known = REASONS.find((candidate) => candidate === reason);
  return known ? t(`queue.reasons.${known}`) : reason;
}

function RunCard({ run, now, linked }: { run: QueueRunView; now: number; linked: boolean }) {
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
            step: steps.current.step,
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
      <a
        className="block min-w-0 truncate font-medium text-primary underline"
        title={run.title}
        href={formatRoute({ view: 'runs', run: run.id, group: null, step: null })}
      >
        {run.title}
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.state} />
        <TagChips tags={run.tags ?? []} />
        {run.delivering ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Truck aria-hidden className="size-4" />
            {t('queue.delivering')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
        <span>{run.workflow}</span>
        <span>{t('format.running', { duration: duration(now - run.createdAt) })}</span>
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
              <code>{active.group}</code>
              {active.step ? <> · {active.step}</> : null}
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
    </Card>
  );
}

/** Runs of the queue that hold a place, as cards, with the free places of a running queue. */
export function QueueRuns({
  queue,
  now,
  highlight = null,
}: {
  queue: QueueView;
  now: number;
  /** Ids linked to the item under the pointer or the focus. */
  highlight?: Set<string> | null;
}) {
  const { t } = useTranslation();
  const running = queue.status === 'running';
  if (queue.runs.length === 0 && !running) return null;
  const free = running ? Math.max(0, queue.parallel - queue.runs.length) : 0;
  return (
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
            <RunCard run={run} now={now} linked={highlight?.has(run.id) === true} />
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
  );
}
