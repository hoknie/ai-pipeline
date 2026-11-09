import { useTranslation } from 'react-i18next';

import {
  cost,
  diffText,
  runTimes,
  runTitle,
  taskNumber,
  usageText,
} from '../../../shared/lib/format.ts';
import { useLocale } from '../../../shared/i18n/index.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { runStatusLabel } from '../../../shared/lib/status.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { orderEntries } from '../../../shared/lib/order.ts';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { TagChips } from '../../../shared/ui/feedback/TagChip.tsx';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { undeliveredMark } from '../header/delivery.ts';
import { RunDecisions } from './RunDecisions.tsx';
import { RunProgress } from './RunProgress.tsx';
import { entryBadge } from './RunStatuses.tsx';
import { RunWarningsBadge } from './RunWarningsBadge.tsx';
import type { RunScope } from './runFilter.ts';

interface RunCardProps {
  run: RunView;
  open: boolean;
  selectedGroup: string | null;
  now: number;
  scope: RunScope;
  onSelect: (runId: string, group: string | null) => void;
}

function UndeliveredBadge({ run }: { run: RunView }) {
  const { t } = useTranslation();
  const mark = undeliveredMark(run);
  if (!mark) return null;
  return (
    <StatusBadge
      status={mark.status}
      label={
        mark.status === 'apply_failed'
          ? t('runs.header.deliveryFailed', { n: run.delivery.failed })
          : undefined
      }
      tip={
        mark.status === 'apply_failed'
          ? (mark.reason ?? undefined)
          : t('runs.list.undeliveredTip', { applied: mark.delivered, merged: mark.merged })
      }
    />
  );
}

function GroupButtons({
  run,
  selectedGroup,
  onSelect,
}: Pick<RunCardProps, 'run' | 'selectedGroup' | 'onSelect'>) {
  const { t } = useTranslation();
  const groups = orderEntries(run);
  return (
    <ul
      aria-label={t('runs.list.groups')}
      className="mt-1 ml-3 flex flex-col gap-0.5 border-l pl-2"
    >
      {groups.map((group) => (
        <li key={group.slug}>
          <button
            type="button"
            aria-current={group.slug === selectedGroup}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
              group.slug === selectedGroup && 'bg-accent font-medium',
            )}
            onClick={() => onSelect(run.id, group.slug)}
          >
            <span className="truncate" title={group.title}>
              {'kind' in group && group.kind !== 'action'
                ? t(`runs.system.${group.kind}`)
                : group.title}
              {'kind' in group ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {t('runs.system.badge')}
                </span>
              ) : null}
            </span>
            {entryBadge(group, t)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One run of the list: its summary as a button and, when open, the buttons of its groups. */
export function RunCard(props: RunCardProps) {
  const { run, open, now, scope, onSelect } = props;
  const { t } = useTranslation();
  const locale = useLocale();
  const times = runTimes(run, now, locale);
  const mark = undeliveredMark(run);
  return (
    <li data-run={run.id}>
      <button
        type="button"
        className={cn(
          'flex w-full flex-col gap-1 rounded-lg border bg-card p-2.5 text-left hover:bg-accent',
          mark && 'border-status-warn/40 bg-status-warn-bg/40',
          open && 'border-primary bg-accent',
        )}
        data-undelivered={mark ? '' : undefined}
        aria-expanded={open}
        title={`${runTitle(run)}\n${run.id}`}
        onClick={() => onSelect(run.id, null)}
      >
        <span className="block min-w-0 text-sm font-medium break-words [overflow-wrap:anywhere]">
          <span className="font-mono text-xs text-muted-foreground">{taskNumber(run.number)}</span>{' '}
          {runTitle(run)}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{run.name ?? '—'}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {scope === 'all' ? (
            <span className="inline-flex items-center gap-1 font-medium" title={run.repository}>
              <ProjectDot path={run.repository} />
              {repositoryLabel(run.repository)}
            </span>
          ) : null}
          <PipelineBadge id={run.pipeline} name={run.pipelineName} focusable={false} />
          <TagChips tags={run.tags ?? []} nested />
        </span>
        <span className="grid grid-cols-2 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={run.state} label={runStatusLabel(run, t)} />
            <RunWarningsBadge run={run} />
            <UndeliveredBadge run={run} />
          </span>
          {run.state === 'finished' ? null : (
            <RunProgress done={run.progress.done} total={run.progress.total} />
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{times.created}</span>
          <span>{times.duration}</span>
          {usageText(run.usage) ? <span>{usageText(run.usage)}</span> : null}
          {cost(run.usage) ? <span>{cost(run.usage)}</span> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {run.liveDiff ? diffText(run.liveDiff, t) : '—'}
        </span>
        <RunDecisions run={run} />
      </button>

      {open && orderEntries(run).length > 1 ? <GroupButtons {...props} /> : null}
    </li>
  );
}
