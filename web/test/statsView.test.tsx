import { describe, expect, it } from 'vitest';

import {
  compactNumber,
  dailySeries,
  isEmpty,
  metricsFor,
  modelOrder,
  nextSort,
  periodSince,
  projectShares,
  projectValue,
  sortRows,
} from '../src/features/stats/statsView.ts';

import { statsReportView } from './fixtures.ts';

const day = (
  name: string,
  projects: { repository: string; tokens: number }[],
  models: {
    model: string;
    tokens: number;
    costUsd: number;
    agentMs: number;
    attempts: number;
  }[] = [],
) => ({
  day: name,
  start: Date.parse(name),
  tokens: projects.reduce((sum, entry) => sum + entry.tokens, 0),
  costUsd: 0,
  agentMs: 0,
  tasks: 0,
  projects: projects.map((entry) => ({ ...entry, costUsd: 0, agentMs: 0, tasks: 0 })),
  models,
});

describe('compactNumber', () => {
  it('shortens thousands and millions', () => {
    expect(compactNumber(90_000)).toBe('90k');
    expect(compactNumber(1500)).toBe('1.5k');
    expect(compactNumber(2_000_000)).toBe('2M');
    expect(compactNumber(999)).toBe('999');
  });
});

describe('periodSince', () => {
  it('starts at local midnight of the first day', () => {
    const now = new Date(2026, 5, 15, 13, 30).getTime();
    expect(periodSince('7d', now)).toBe(new Date(2026, 5, 9).getTime());
    expect(periodSince('all', now)).toBeUndefined();
  });
});

describe('sorting', () => {
  it('goes up on the first click and flips on the second', () => {
    const first = nextSort(null, 'tokens');
    expect(first).toEqual({ key: 'tokens', direction: 'asc' });
    expect(nextSort(first, 'tokens').direction).toBe('desc');
    expect(nextSort(first, 'cost')).toEqual({ key: 'cost', direction: 'asc' });
  });

  it('puts a missing number last in both directions', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }];
    const value = (row: { v: number | null }) => row.v;
    expect(sortRows(rows, { key: 'v', direction: 'asc' }, value).map(value)).toEqual([1, 2, null]);
    expect(sortRows(rows, { key: 'v', direction: 'desc' }, value).map(value)).toEqual([2, 1, null]);
  });

  it('sorts text by locale', () => {
    const rows = [{ n: 'b' }, { n: 'A' }];
    expect(sortRows(rows, { key: 'n', direction: 'asc' }, (row) => row.n).map((r) => r.n)).toEqual([
      'A',
      'b',
    ]);
  });
});

describe('dailySeries', () => {
  const options = {
    labelOf: (repository: string) => repository.toUpperCase(),
    colors: { '/a': '#111' } as Record<string, string>,
    other: { label: 'Other', color: '#999' },
  };

  it('makes one series per project with a value for every day', () => {
    const report = statsReportView({
      series: [day('2026-06-01', [{ repository: '/a', tokens: 5 }]), day('2026-06-02', [])],
    });
    const [only] = dailySeries(report, 'tokens', 'projects', options);
    expect(only).toMatchObject({ key: '/a', label: '/A', color: '#111', values: [5, 0] });
  });

  it('folds more than eight projects', () => {
    const projects = Array.from({ length: 11 }, (_, index) => ({
      repository: `/p${index}`,
      tokens: index + 1,
    }));
    const report = statsReportView({ series: [day('2026-06-01', projects)] });
    const series = dailySeries(report, 'tokens', 'projects', options);
    expect(series).toHaveLength(9);
    expect(series[8]).toMatchObject({ label: 'Other', values: [6] });
  });
});

describe('models split', () => {
  const options = {
    labelOf: (repository: string) => repository.toUpperCase(),
    colors: { opus: '#111' } as Record<string, string>,
    other: { label: 'Other', color: '#999' },
  };
  const entry = (model: string, tokens: number) => ({
    model,
    tokens,
    costUsd: 0,
    agentMs: 0,
    attempts: 1,
  });

  it('makes one series per model with a value for every day', () => {
    const report = statsReportView({
      series: [
        day('2026-06-01', [], [entry('opus', 5), entry('sonnet', 7)]),
        day('2026-06-02', [], [entry('sonnet', 3)]),
      ],
    });
    const series = dailySeries(report, 'tokens', 'models', options);
    expect(series).toMatchObject([
      { key: 'opus', label: 'opus', color: '#111', values: [5, 0] },
      { key: 'sonnet', label: 'sonnet', color: '#999', values: [7, 3] },
    ]);
  });

  it('folds more than eight models', () => {
    const models = Array.from({ length: 10 }, (_, index) => entry(`m${index}`, index + 1));
    const report = statsReportView({ series: [day('2026-06-01', [], models)] });
    const series = dailySeries(report, 'tokens', 'models', options);
    expect(series).toHaveLength(9);
    expect(series[8]).toMatchObject({ label: 'Other', values: [3] });
  });

  it('offers no tasks for models and no cost without one', () => {
    expect(metricsFor('models', true)).toEqual(['tokens', 'cost', 'agent']);
    expect(metricsFor('projects', true)).toEqual(['tokens', 'cost', 'agent', 'tasks']);
    expect(metricsFor('projects', false)).toEqual(['tokens', 'agent', 'tasks']);
  });

  it('orders the models by the breakdown, then by the series', () => {
    const base = statsReportView();
    const row = (key: string) => ({ ...base.byModel[0]!, key });
    const report = statsReportView({
      byModel: [row('opus'), row('sonnet')],
      series: [day('2026-06-01', [], [entry('haiku', 1), entry('sonnet', 2)])],
    });
    expect(modelOrder(report)).toEqual(['opus', 'sonnet', 'haiku']);
  });
});

describe('projects', () => {
  it('reads the columns of a row', () => {
    const base = statsReportView();
    const row = { totals: { ...base.totals, tokens: 7, costUsd: null }, perTask: base.perTask };
    expect(projectValue(row, 'tokens')).toBe(7);
    expect(projectValue(row, 'cost')).toBeNull();
    expect(projectValue(row, 'unknown')).toBeNull();
  });

  it('ranks the shares and drops projects without a value', () => {
    const base = statsReportView();
    const make = (repository: string, tokens: number) => ({
      repository,
      totals: { ...base.totals, tokens },
      perTask: base.perTask,
    });
    const report = statsReportView({ projects: [make('/a', 10), make('/b', 90), make('/c', 0)] });
    expect(projectShares(report, 'tokens').map((row) => row.repository)).toEqual(['/b', '/a']);
  });

  it('knows an empty report', () => {
    expect(isEmpty(statsReportView())).toBe(true);
  });
});
