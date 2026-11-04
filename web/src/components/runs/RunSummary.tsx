import { useTranslation } from 'react-i18next';

import { cost, duration, usageText } from '../../format.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../types.ts';
import { FilePath } from '../FilePath.tsx';
import { WorkflowBadge } from '../WorkflowBadge.tsx';
import { RunStatuses } from './RunStatuses.tsx';

/** The summary block of a run: statuses, path, time, tokens, cost and the type of the task. */
export function RunSummary({
  run,
  now,
  entry = null,
  onSelect,
}: {
  run: RunView;
  now: number;
  entry?: GroupRow | SystemStepRow | null;
  onSelect?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const tokens = usageText(run.usage);
  const price = cost(run.usage);
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: 'status',
      label: t('runs.header.summary.status'),
      value: <RunStatuses run={run} entry={entry} onSelect={onSelect} />,
    },
    {
      key: 'path',
      label: t('runs.header.summary.path'),
      value: <FilePath path={run.repository} variant="line" />,
    },
    {
      key: 'time',
      label: t('runs.header.summary.time'),
      value: duration((run.finishedAt ?? now) - run.createdAt),
    },
    ...(tokens ? [{ key: 'tokens', label: t('runs.header.summary.tokens'), value: tokens }] : []),
    ...(price ? [{ key: 'cost', label: t('runs.header.summary.cost'), value: price }] : []),
    {
      key: 'type',
      label: t('runs.header.summary.type'),
      value: <WorkflowBadge id={run.workflow} name={run.workflowName} />,
    },
  ];
  return (
    <aside aria-label={t('runs.header.summary.label')} className="shrink-0 border-l pl-4 @3xl:w-96">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
