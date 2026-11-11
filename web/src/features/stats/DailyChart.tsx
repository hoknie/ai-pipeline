import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { repositoryColor, repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { BarChart, type ChartCategory } from '../../shared/ui/charts/index.ts';
import { assignColors, NEUTRAL_COLOR } from '../../shared/ui/charts/palette.ts';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import {
  compactNumber,
  dailySeries,
  durationText,
  METRICS,
  money,
  type Metric,
} from './statsView.ts';

/** The daily bars of one metric, stacked by project. */
export function DailyChart({ report }: { report: StatsReportView }) {
  const { t, i18n } = useTranslation();
  const [chosen, setChosen] = useState<Metric>('tokens');
  const metrics = METRICS.filter((metric) => metric !== 'cost' || report.totals.costUsd !== null);
  const metric = metrics.includes(chosen) ? chosen : 'tokens';

  const repositories = [
    ...new Set(report.series.flatMap((day) => day.projects.map((entry) => entry.repository))),
  ];
  const series = dailySeries(report, metric, {
    labelOf: repositoryLabel,
    colors: assignColors(repositories, repositoryColor),
    other: { label: t('stats.daily.other'), color: NEUTRAL_COLOR },
  });
  const short = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
  const long = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const categories: ChartCategory[] = report.series.map((day) => ({
    key: day.day,
    label: short.format(day.start),
    title: long.format(day.start),
  }));
  const format = (value: number) =>
    metric === 'tokens'
      ? compactNumber(value)
      : metric === 'cost'
        ? money(value)
        : metric === 'agent'
          ? durationText(value, t)
          : String(Math.round(value));
  const name = t(`stats.daily.metrics.${metric}` as never);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('stats.daily.title')}</h2>
        <ToggleGroup
          type="single"
          value={metric}
          aria-label={t('stats.daily.metric')}
          onValueChange={(next) => {
            const found = METRICS.find((candidate) => candidate === next);
            if (found !== undefined) setChosen(found);
          }}
        >
          {metrics.map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {t(`stats.daily.metrics.${id}` as never)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <BarChart
        label={t('stats.daily.chartLabel', { metric: name })}
        categories={categories}
        series={series}
        format={format}
        categoryHead={t('stats.daily.day')}
        totalLabel={t('stats.daily.total')}
      />
    </Card>
  );
}
