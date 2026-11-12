import type { TFunction } from 'i18next';

import type { StatsPeriodId } from '../../shared/lib/nav/route.ts';
import type { StatsReportView } from '../../shared/api/types.ts';
import { foldSeries, type ChartSeries } from '../../shared/ui/charts/scale.ts';

type Totals = StatsReportView['totals'];
type PerTask = StatsReportView['perTask'];
type Breakdown = StatsReportView['byModel'][number];

export const METRICS = ['tokens', 'cost', 'agent', 'tasks'] as const;
export type Metric = (typeof METRICS)[number];

/** How many series the daily chart draws before the rest folds into «Other». */
export const CHART_SERIES_LIMIT = 8;

const DAY_COUNT: Record<Exclude<StatsPeriodId, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Start of the period (ms): local midnight of its first day, as the daemon counts days. */
export function periodSince(period: StatsPeriodId, now: number): number | undefined {
  if (period === 'all') return undefined;
  const date = new Date(now);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - (DAY_COUNT[period] - 1),
  ).getTime();
}

/** `90k`, `1.5M`: the number with `k` and `M`, without a trailing `.0`. */
export function compactNumber(value: number): string {
  const trim = (number: number) => String(Number(number.toFixed(1)));
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return String(Math.round(value));
}

export const money = (usd: number): string => `$${usd.toFixed(2)}`;

/** `1 h 30 min`, `45 min`, `20 s`: the units come from the dictionary of the panel. */
export function durationText(milliseconds: number, t: TFunction): string {
  const minutes = Math.round(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) {
    return t('stats.unit.seconds' as never, { count: Math.round(milliseconds / 1000) });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('stats.unit.minutes' as never, { count: rest });
  if (rest === 0) return t('stats.unit.hours' as never, { count: hours });
  const hoursText = t('stats.unit.hours' as never, { count: hours });
  return `${hoursText} ${t('stats.unit.minutes' as never, { count: rest })}`;
}

/** The value of a metric of a day or of a project of a day. */
function metricOf(
  metric: Metric,
  entry: { tokens: number; costUsd: number | null; agentMs: number; tasks: number },
): number {
  if (metric === 'tokens') return entry.tokens;
  if (metric === 'cost') return entry.costUsd ?? 0;
  if (metric === 'agent') return entry.agentMs;
  return entry.tasks;
}

/**
 * The series of the daily chart: one per project, a value for every day of the report. Projects
 * beyond `CHART_SERIES_LIMIT` with the smallest sum are folded into «Other».
 */
export function dailySeries(
  report: StatsReportView,
  metric: Metric,
  options: {
    labelOf: (repository: string) => string;
    colors: Record<string, string>;
    other: { label: string; color: string };
  },
): ChartSeries[] {
  const repositories = [
    ...new Set(report.series.flatMap((day) => day.projects.map((entry) => entry.repository))),
  ];
  const series = repositories.map<ChartSeries>((repository) => ({
    key: repository,
    label: options.labelOf(repository),
    color: options.colors[repository] ?? options.other.color,
    values: report.series.map((day) => {
      const entry = day.projects.find((candidate) => candidate.repository === repository);
      return entry === undefined ? 0 : metricOf(metric, entry);
    }),
  }));
  return foldSeries(series, CHART_SERIES_LIMIT, options.other);
}

export type SortDirection = 'asc' | 'desc';
export interface Sort {
  key: string;
  direction: SortDirection;
}

/** The sort after a click on a header: a new column goes up first, the same one flips. */
export function nextSort(current: Sort | null, key: string): Sort {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

/** The rows sorted by the value `valueOf` gives; text sorts by locale, a missing number last. */
export function sortRows<T>(
  rows: readonly T[],
  sort: Sort | null,
  valueOf: (row: T, key: string) => string | number | null,
): T[] {
  if (sort === null) return [...rows];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = valueOf(left, sort.key);
    const b = valueOf(right, sort.key);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (typeof a === 'string' || typeof b === 'string') {
      return sign * String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
    }
    return sign * (a - b);
  });
}

export type ProjectRow = StatsReportView['projects'][number];

/** The value of a column of the table of projects. */
export function projectValue(
  row: { totals: Totals; perTask: PerTask },
  key: string,
): number | null {
  const { totals, perTask } = row;
  switch (key) {
    case 'tasks':
      return totals.tasks;
    case 'tokens':
      return totals.tokens;
    case 'cost':
      return totals.costUsd;
    case 'agent':
      return totals.agentMs;
    case 'wall':
      return totals.wallMs;
    case 'meanTokens':
      return perTask.tokens.mean;
    case 'medianTokens':
      return perTask.tokens.median;
    case 'meanAgent':
      return perTask.agentMs.mean;
    case 'medianAgent':
      return perTask.agentMs.median;
    default:
      return null;
  }
}

/** The value of a column of a table of a breakdown. */
export function breakdownValue(row: Breakdown, key: string): string | number | null {
  switch (key) {
    case 'name':
      return row.key;
    case 'attempts':
      return row.attempts;
    case 'input':
      return row.inputTokens;
    case 'output':
      return row.outputTokens;
    case 'cost':
      return row.costUsd;
    case 'agent':
      return row.agentMs;
    case 'perAttempt':
      return row.tokensPerAttempt;
    default:
      return null;
  }
}

/** The shares of the projects in a metric, the largest first; projects with nothing are left out. */
export function projectShares(
  report: StatsReportView,
  metric: 'tokens' | 'agent',
): { repository: string; value: number }[] {
  return report.projects
    .map((row) => ({
      repository: row.repository,
      value: metric === 'tokens' ? row.totals.tokens : row.totals.agentMs,
    }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
}

/** Whether the report has nothing to show in its period. */
export function isEmpty(report: StatsReportView): boolean {
  return report.totals.tasks === 0 && report.totals.attempts === 0;
}
