import { Truck } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { clock, cost, duration, usageText } from '../../../shared/lib/format.ts';
import { waitText } from '../../../shared/lib/status.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { QueueRunView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { reasonText } from './reasonText.ts';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { TagChips } from '../../../shared/ui/feedback/TagChip.tsx';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';

/** A group slug; the slug of a system step (`_split`, `_message`, `_resolve`) becomes its name. */
function groupLabel(slug: string, t: TFunction) {
  const kind = slug.startsWith('_action-')
    ? 'action'
    : (/^_(split|message|resolve|repair)$/.exec(slug)?.[1] as
        'split' | 'message' | 'resolve' | 'repair' | undefined);
  return kind ? <span>{t(`runs.system.${kind}`)}</span> : <code>{slug}</code>;
}

/** The status, pipeline and tags of a run, with the priority and delivery marks. */
export function CardBadges({ run }: { run: QueueRunView }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={run.state} />
      <PipelineBadge id={run.pipeline} name={run.pipelineName} />
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
  );
}

/** The system steps of a run and the state of its delivery. */
export function SystemStages({ run }: { run: QueueRunView }) {
  const { t } = useTranslation();
  if (run.system.length === 0 && !run.delivery) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t('runs.system.stages')}>
      {run.system.map((step, index) => (
        <span
          key={`${step.kind}-${index}`}
          className="inline-flex items-center gap-1 text-muted-foreground"
        >
          {step.kind === 'action'
            ? (step.title ?? t('runs.system.action'))
            : t(`runs.system.${step.kind}`)}
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
  );
}

/** How long the run lasts, what it used and until when a limit holds it. */
export function Usage({ run, now }: { run: QueueRunView; now: number }) {
  const { t } = useTranslation();
  return (
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
  );
}

/** The bar of finished steps with a caption: groups and steps, or the current step. */
export function Progress({ run }: { run: QueueRunView }) {
  const { t } = useTranslation();
  const { total } = run.groups;
  const { steps } = run;
  if (total === 0) return <span className="text-muted-foreground">{t('queue.splitting')}</span>;
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
  return (
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
  );
}

/** The groups that work now and the ones that wait for a place or a limit. */
export function ActiveGroups({ run }: { run: QueueRunView }) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}

/** The problem that stopped the run, with a link to the place it happened. */
export function Problem({ run }: { run: QueueRunView }) {
  const { t } = useTranslation();
  const { problem } = run;
  if (!problem) return null;
  return (
    <div className="text-destructive">
      <code>{problem.reason}</code> — {reasonText(problem.reason, t)}.{' '}
      <a
        className="underline"
        href={formatRoute({
          view: 'runs',
          run: run.id,
          group: problem.group,
          step: null,
          tab: null,
        })}
      >
        {problem.group ? t('queue.openGroup', { group: problem.group }) : t('queue.openRun')}
      </a>
    </div>
  );
}
