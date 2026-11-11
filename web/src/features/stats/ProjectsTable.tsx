import type { TFunction } from 'i18next';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { StatsReportView } from '../../shared/api/types.ts';
import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { ProjectDot } from '../../shared/ui/feedback/ProjectDot.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import { ClearProjectAction } from './ClearProjectAction.tsx';
import { StatsTable, type StatsColumn } from './StatsTable.tsx';
import {
  compactNumber,
  durationText,
  money,
  nextSort,
  projectValue,
  sortRows,
  type ProjectRow,
  type Sort,
} from './statsView.ts';

/** `repository: null` is the row «All projects». */
type Row =
  ProjectRow | { repository: null; totals: ProjectRow['totals']; perTask: ProjectRow['perTask'] };

function columnsOf(options: {
  t: TFunction;
  showCost: boolean;
  onSelect: (repository: string) => void;
  actions: (repository: string) => ReactNode;
}): StatsColumn<Row>[] {
  const { t, showCost, onSelect, actions } = options;
  const number = (
    key: string,
    label: string,
    text: (row: Row) => string | null,
  ): StatsColumn<Row> => ({ key, label, numeric: true, cell: (row) => text(row) ?? '—' });
  const duration = (ms: number) => durationText(ms, t);
  return [
    {
      key: 'name',
      label: t('stats.projects.project'),
      cell: (row) =>
        row.repository === null ? (
          t('stats.projects.all')
        ) : (
          <span className="flex items-center gap-1.5">
            <ProjectDot path={row.repository} />
            <button
              type="button"
              className="rounded-sm text-left hover:underline"
              title={row.repository}
              onClick={() => onSelect(row.repository)}
            >
              {repositoryLabel(row.repository)}
            </button>
          </span>
        ),
    },
    number('tasks', t('stats.projects.tasks'), (row) => String(row.totals.tasks)),
    number('tokens', t('stats.tiles.tokens'), (row) => compactNumber(row.totals.tokens)),
    ...(showCost
      ? [
          number('cost', t('stats.tiles.cost'), (row) =>
            row.totals.costUsd === null ? null : money(row.totals.costUsd),
          ),
        ]
      : []),
    number('agent', t('stats.tiles.agent'), (row) => duration(row.totals.agentMs)),
    number('wall', t('stats.projects.wall'), (row) => duration(row.totals.wallMs)),
    number('meanTokens', t('stats.projects.meanTokens'), (row) =>
      compactNumber(row.perTask.tokens.mean),
    ),
    number('medianTokens', t('stats.projects.medianTokens'), (row) =>
      compactNumber(row.perTask.tokens.median),
    ),
    number('meanAgent', t('stats.projects.meanAgent'), (row) => duration(row.perTask.agentMs.mean)),
    number('medianAgent', t('stats.projects.medianAgent'), (row) =>
      duration(row.perTask.agentMs.median),
    ),
    {
      key: 'actions',
      label: '',
      cell: (row) => (row.repository === null ? null : actions(row.repository)),
    },
  ];
}

/** The projects of the period, «All projects» first; a click on a name picks the project. */
export function ProjectsTable({
  api,
  report,
  onSelect,
  onCleared,
}: {
  api: Api;
  report: StatsReportView;
  onSelect: (repository: string) => void;
  onCleared: () => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort | null>(null);
  const rows = sortRows<ProjectRow>(report.projects, sort, (row, key) =>
    key === 'name' ? repositoryLabel(row.repository) : projectValue(row, key),
  );
  const total: Row = { repository: null, totals: report.totals, perTask: report.perTask };
  const columns = columnsOf({
    t,
    showCost: report.totals.costUsd !== null,
    onSelect,
    actions: (repository) => (
      <ClearProjectAction api={api} repository={repository} onCleared={onCleared} />
    ),
  });
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{t('stats.projects.title')}</h2>
      <StatsTable<Row>
        caption={t('stats.projects.title')}
        columns={columns}
        rows={rows}
        pinned={total}
        sort={sort}
        onSort={(key) => setSort((current) => nextSort(current, key))}
        rowKey={(row) => row.repository ?? '\u0000all'}
      />
    </Card>
  );
}
