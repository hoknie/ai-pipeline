import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { Card } from '../../shared/ui/layout/card.tsx';
import { StatsTable, type StatsColumn } from './StatsTable.tsx';
import {
  breakdownValue,
  compactNumber,
  durationText,
  nextSort,
  sortRows,
  type Sort,
} from './statsView.ts';

type Row = NonNullable<StatsReportView['byAuthor']>[number];

/** The key of the row of the records without an author. */
const NO_AUTHOR = 'none';

/** The table «By authors» of the server mode; a click on a row chooses the author in the filter. */
export function AuthorsTable({
  report,
  onSelect,
}: {
  report: StatsReportView;
  onSelect: (author: string) => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort | null>(null);
  const rows = report.byAuthor ?? [];
  if (rows.length === 0) return null;
  const labelOf = (row: Row): string =>
    row.key === NO_AUTHOR ? t('author.table.none') : (row.name ?? row.email ?? row.key);
  const number = (key: string, label: string, text: (row: Row) => string): StatsColumn<Row> => ({
    key,
    label,
    numeric: true,
    cell: text,
  });
  const columns: StatsColumn<Row>[] = [
    {
      key: 'name',
      label: t('author.table.name'),
      cell: (row) =>
        row.key === NO_AUTHOR ? (
          labelOf(row)
        ) : (
          <button
            type="button"
            className="rounded-sm text-left hover:underline"
            title={row.email ?? row.key}
            onClick={() => onSelect(row.key)}
          >
            {labelOf(row)}
          </button>
        ),
    },
    number('attempts', t('stats.breakdown.attempts'), (row) => String(row.attempts)),
    number('tokens', t('stats.tiles.tokens'), (row) => compactNumber(row.tokens)),
    number('agent', t('stats.tiles.agent'), (row) => durationText(row.agentMs, t)),
    number('perAttempt', t('stats.breakdown.perAttempt'), (row) =>
      compactNumber(row.tokensPerAttempt),
    ),
  ];
  const valueOf = (row: Row, key: string) =>
    key === 'name' ? labelOf(row) : key === 'tokens' ? row.tokens : breakdownValue(row, key);
  return (
    <Card className="p-4" data-testid="authors-table">
      <h3 className="mb-2 font-semibold">{t('author.table.title')}</h3>
      <StatsTable<Row>
        caption={t('author.table.title')}
        columns={columns}
        rows={sortRows(rows, sort, valueOf)}
        sort={sort}
        onSort={(key) => setSort((current) => nextSort(current, key))}
        rowKey={(row) => row.key}
      />
    </Card>
  );
}
