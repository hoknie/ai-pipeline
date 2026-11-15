import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StatsReportView } from '../../shared/api/types.ts';
import { repositoryColor, repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { AreaChart } from '../../shared/ui/charts/index.ts';
import { assignColors, NEUTRAL_COLOR } from '../../shared/ui/charts/palette.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import {
  buildChartCategories,
  compactNumber,
  dailySeries,
  durationText,
  METRICS,
  metricsFor,
  modelLabel,
  modelOrder,
  SPLITS,
  type Metric,
  type Split,
} from './statsView.ts';

/** The daily bars of one metric, stacked by project or by model. */
function DailyChartHeader(props: {
  bucket: '6h' | 'day' | 'week';
  metrics: Metric[];
  metric: Metric;
  split: Split;
  onMetric: (metric: Metric) => void;
  onSplit: (split: Split) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t('stats.daily.title')}</h2>
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {t(`stats.daily.buckets.${props.bucket}` as never)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={props.split}
          aria-label={t('stats.daily.split')}
          onValueChange={(next) => {
            const found = SPLITS.find((candidate) => candidate === next);
            if (found !== undefined) props.onSplit(found);
          }}
        >
          {SPLITS.map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {t(`stats.daily.splits.${id}` as never)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={props.metric}
          aria-label={t('stats.daily.metric')}
          onValueChange={(next) => {
            const found = METRICS.find((candidate) => candidate === next);
            if (found !== undefined) props.onMetric(found);
          }}
        >
          {props.metrics.map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {t(`stats.daily.metrics.${id}` as never)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

export function DailyChart({ report }: { report: StatsReportView }) {
  const { t, i18n } = useTranslation();
  const [chosen, setChosen] = useState<Metric>('tokens');
  const [split, setSplit] = useState<Split>('projects');
  const metrics = metricsFor(split);
  const metric = metrics.includes(chosen) ? chosen : 'tokens';
  const bucket = report.bucket ?? 'day';

  const keys =
    split === 'models'
      ? modelOrder(report)
      : [...new Set(report.series.flatMap((day) => day.projects.map((entry) => entry.repository)))];
  const series = dailySeries(report, metric, split, {
    labelOf: repositoryLabel,
    modelLabelOf: (model) => modelLabel(model, t),
    colors: assignColors(keys, split === 'models' ? () => null : repositoryColor),
    other: { label: t('stats.daily.other'), color: NEUTRAL_COLOR },
  });
  const categories = buildChartCategories(report.series, bucket, i18n.language);
  const format = (value: number) =>
    metric === 'tokens'
      ? compactNumber(value)
      : metric === 'agent'
        ? durationText(value, t)
        : String(Math.round(value));
  const name = t(`stats.daily.metrics.${metric}` as never);
  const labelKey = split === 'models' ? 'stats.daily.chartLabelModels' : 'stats.daily.chartLabel';
  return (
    <Card className="flex flex-col gap-3 p-4">
      <DailyChartHeader
        bucket={bucket}
        metrics={metrics}
        metric={metric}
        split={split}
        onMetric={setChosen}
        onSplit={setSplit}
      />
      <AreaChart
        label={t(labelKey, { metric: name })}
        categories={categories}
        series={series}
        format={format}
        categoryHead={t(`stats.daily.categoryHeads.${bucket}` as never)}
        totalLabel={t('stats.daily.total')}
      />
    </Card>
  );
}
