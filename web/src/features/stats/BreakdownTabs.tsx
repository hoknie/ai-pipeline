import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { Card } from '../../shared/ui/layout/card.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/layout/tabs.tsx';
import { StatsTable, type StatsColumn } from './StatsTable.tsx';
import {
  breakdownValue,
  compactNumber,
  durationText,
  money,
  nextSort,
  sortRows,
  type Sort,
} from './statsView.ts';

type Row = StatsReportView['byModel'][number];

const TABS = [
  { id: 'specialist', rows: (report: StatsReportView) => report.bySpecialist },
  { id: 'model', rows: (report: StatsReportView) => report.byModel },
  { id: 'pipeline', rows: (report: StatsReportView) => report.byPipeline },
  { id: 'runtime', rows: (report: StatsReportView) => report.byRuntime },
] as const;

/** The tables of the breakdowns: specialists, models, pipelines and runtimes. */
export function BreakdownTabs({ report }: { report: StatsReportView }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<string>('specialist');
  const [sort, setSort] = useState<Sort | null>(null);
  const showCost = report.totals.costUsd !== null;
  const number = (key: string, label: string, text: (row: Row) => string): StatsColumn<Row> => ({
    key,
    label,
    numeric: true,
    cell: text,
  });
  const columns: StatsColumn<Row>[] = [
    { key: 'name', label: t('stats.breakdown.name'), cell: (row) => row.key },
    number('attempts', t('stats.breakdown.attempts'), (row) => String(row.attempts)),
    number('input', t('stats.breakdown.input'), (row) => compactNumber(row.inputTokens)),
    number('output', t('stats.breakdown.output'), (row) => compactNumber(row.outputTokens)),
    ...(showCost
      ? [
          number('cost', t('stats.tiles.cost'), (row) =>
            row.costUsd === null ? '—' : money(row.costUsd),
          ),
        ]
      : []),
    number('agent', t('stats.tiles.agent'), (row) => durationText(row.agentMs, t)),
    number('perAttempt', t('stats.breakdown.perAttempt'), (row) =>
      compactNumber(row.tokensPerAttempt),
    ),
  ];
  return (
    <Card className="p-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('stats.breakdown.title')}>
          {TABS.map(({ id }) => (
            <TabsTrigger key={id} value={id}>
              {t(`stats.breakdown.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(({ id, rows }) => (
          <TabsContent key={id} value={id}>
            <StatsTable<Row>
              caption={t(`stats.breakdown.tabs.${id}`)}
              columns={columns}
              rows={sortRows(rows(report), sort, breakdownValue)}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
              rowKey={(row) => row.key}
            />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
