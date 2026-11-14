import { describe, expect, it } from 'vitest';

import {
  breakdownRows,
  dailySeries,
  dayOf,
  maskCosts,
  median,
  outcomesOf,
  parseStatsPeriod,
  perTaskOf,
  totalsOf,
  type StatsReport,
} from '../../../src/feature/stats/types/index.ts';
import { attemptRecord, taskRecord } from './helpers.ts';

const MINUTE = 60_000;

describe('statistics aggregates', () => {
  it('takes the median beside the mean: 10, 20 and 300 thousand tokens', () => {
    const tasks = [10_000, 20_000, 300_000].map((tokens, index) =>
      taskRecord({ runId: `t${index}` }),
    );
    const attempts = [10_000, 20_000, 300_000].map((tokens, index) =>
      attemptRecord({ runId: `t${index}`, inputTokens: tokens, outputTokens: 0 }),
    );
    const { tokens } = perTaskOf(attempts, tasks);
    expect(tokens.mean).toBeCloseTo(110_000);
    expect(tokens.median).toBe(20_000);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('counts agent work without command time, and naming without time', () => {
    const attempts = [
      attemptRecord({ durationMs: 20 * MINUTE }),
      attemptRecord({
        runtime: 'command',
        durationMs: 5 * MINUTE,
        inputTokens: 0,
        outputTokens: 0,
      }),
      attemptRecord({ kind: 'naming', durationMs: 0, inputTokens: 800, outputTokens: 40 }),
    ];
    const totals = totalsOf(attempts, []);
    expect(totals.agentMs).toBe(20 * MINUTE);
    expect(totals.commandMs).toBe(5 * MINUTE);
    expect(totals.inputTokens).toBe(900);
    expect(totals.outputTokens).toBe(90);
    expect(totals.tokens).toBe(990);
  });

  it('counts attempts without a cost and keeps the sum of the known ones', () => {
    const totals = totalsOf(
      [attemptRecord({ costUsd: 0.5 }), attemptRecord({ costUsd: null })],
      [],
    );
    expect(totals.costUsd).toBeCloseTo(0.5);
    expect(totals.attemptsWithoutCost).toBe(1);
  });

  it('counts the tasks by outcome', () => {
    expect(
      outcomesOf([
        taskRecord(),
        taskRecord({ outcome: 'failed' }),
        taskRecord({ outcome: 'failed' }),
        taskRecord({ outcome: 'cancelled' }),
      ]),
    ).toEqual({ finished: 1, failed: 2, cancelled: 1 });
  });

  it('breaks the attempts down by a field, the biggest consumers first', () => {
    const rows = breakdownRows(
      [
        attemptRecord({ model: 'sonnet', inputTokens: 100, outputTokens: 0 }),
        attemptRecord({ model: 'opus', inputTokens: 900, outputTokens: 100 }),
        attemptRecord({ model: 'sonnet', inputTokens: 300, outputTokens: 0 }),
      ],
      (record) => record.model ?? 'unknown',
    );
    expect(rows.map((row) => [row.key, row.attempts, row.tokens])).toEqual([
      ['opus', 1, 1000],
      ['sonnet', 2, 400],
    ]);
    expect(rows[1]?.tokensPerAttempt).toBe(200);
  });

  it('draws seven days with zeros where nothing happened', () => {
    const day = 86_400_000;
    const end = new Date(2026, 5, 10, 15).getTime();
    const attempts = [
      attemptRecord({ finishedAt: end - day, repository: '/work/app' }),
      attemptRecord({ finishedAt: end, repository: '/work/lib' }),
    ];
    const from = new Date(2026, 5, 4).getTime();
    const series = dailySeries(attempts, [taskRecord({ finishedAt: end })], from, end);
    expect(series).toHaveLength(7);
    expect(series.filter((entry) => entry.tokens === 0)).toHaveLength(5);
    expect(series.at(-1)).toMatchObject({ day: dayOf(end), tasks: 1, tokens: 150 });
    expect(series.at(-1)?.projects.map((project) => project.repository)).toEqual([
      '/work/app',
      '/work/lib',
    ]);
    expect(series[0]).toMatchObject({ tokens: 0, tasks: 0, projects: [], models: [] });
  });

  it('splits a day by model: the models add up to the day', () => {
    const at = new Date(2026, 5, 10, 12).getTime();
    const make = (model: string | null, tokens: number, costUsd: number) =>
      attemptRecord({ finishedAt: at, model, inputTokens: tokens, outputTokens: 0, costUsd });
    const attempts = [
      make('sonnet', 20_000, 0.2),
      make('sonnet', 10_000, 0.1),
      make('opus', 10_000, 1),
      make(null, 5_000, 0.05),
    ];
    const [today] = dailySeries(attempts, [], at, at);
    expect(today?.models.map((entry) => entry.model)).toEqual(['opus', 'sonnet', 'unknown']);
    expect(today?.models.map((entry) => entry.tokens)).toEqual([10_000, 30_000, 5_000]);
    expect(today?.models.map((entry) => entry.attempts)).toEqual([1, 2, 1]);
    const add = (
      pick: (entry: { tokens: number; costUsd: number | null; agentMs: number }) => number | null,
    ) => today?.models.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
    expect(add((entry) => entry.tokens)).toBe(today?.tokens);
    expect(add((entry) => entry.agentMs)).toBe(today?.agentMs);
    expect(add((entry) => entry.costUsd)).toBeCloseTo(today?.costUsd ?? 0);
  });

  it('keeps a record between a mid-day start and the next midnight in the series', () => {
    const from = new Date(2026, 5, 9, 14).getTime();
    const end = new Date(2026, 5, 10, 15).getTime();
    const early = attemptRecord({ finishedAt: new Date(2026, 5, 9, 20).getTime() });
    const series = dailySeries([early], [], from, end);
    expect(series.map((entry) => entry.day)).toEqual([dayOf(from), dayOf(end)]);
    expect(series[0]?.tokens).toBe(150);
  });

  it('parses the period of aip stats', () => {
    const now = new Date(2026, 5, 10, 15).getTime();
    expect(parseStatsPeriod('7d', now)).toEqual({
      ok: true,
      since: new Date(2026, 5, 4).getTime(),
    });
    expect(parseStatsPeriod('12h', now)).toEqual({ ok: true, since: now - 12 * 3_600_000 });
    expect(parseStatsPeriod('2w', now)).toEqual({
      ok: true,
      since: new Date(2026, 5, -3).getTime(),
    });
    expect(parseStatsPeriod('all', now)).toEqual({ ok: true, since: null });
    for (const bad of ['soon', '0d', '-1d', '7', '7m', '']) {
      expect(parseStatsPeriod(bad, now)).toMatchObject({ ok: false });
    }
  });

  it('empties every cost field and keeps tokens and times', () => {
    const attempts = [attemptRecord({ costUsd: 1 })];
    const tasks = [taskRecord({ runId: attempts[0]!.runId })];
    const perTask = perTaskOf(attempts, tasks);
    const report = {
      settings: { enabled: true, exclude: [], showCost: false, backfilledAt: null },
      since: null,
      until: null,
      repository: null,
      totals: totalsOf(attempts, tasks),
      perTask,
      outcomes: outcomesOf(tasks),
      projects: [{ repository: '/work/app', totals: totalsOf(attempts, tasks), perTask }],
      bySpecialist: breakdownRows(attempts, (record) => record.specialist),
      byModel: [],
      byPipeline: [],
      byRuntime: [],
      series: dailySeries(attempts, tasks, 1000, 2000),
    } satisfies StatsReport;
    const masked = maskCosts(report);
    expect(JSON.stringify(masked)).not.toMatch(/"costUsd":[0-9]/);
    expect(masked.perTask.costUsd).toEqual({ mean: null, median: null });
    expect(masked.series.flatMap((entry) => entry.models).every((m) => m.costUsd === null)).toBe(
      true,
    );
    expect(masked.series.flatMap((entry) => entry.models).length).toBeGreaterThan(0);
    expect(masked.totals.tokens).toBe(150);
    expect(masked.bySpecialist[0]?.tokens).toBe(150);
  });
});
