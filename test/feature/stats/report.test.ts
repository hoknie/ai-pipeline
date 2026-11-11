import { describe, expect, it } from 'vitest';

import {
  StatsMetaRepository,
  StatsRecordRepository,
  StatsReportRepository,
} from '../../../src/feature/stats/repositories/index.ts';
import { StatsReportService } from '../../../src/feature/stats/services/index.ts';
import { dayOf, parseStatsPeriod } from '../../../src/feature/stats/types/index.ts';
import type { StatsSettings } from '../../../src/feature/swarm-config/types/index.ts';
import { temporaryStorage } from '../storage.ts';
import { attemptRecord, taskRecord } from './helpers.ts';

const MINUTE = 60_000;

function sumOf(series: { tokens: number }[]): number {
  return series.reduce((total, entry) => total + entry.tokens, 0);
}
const NOW = new Date(2026, 5, 10, 12).getTime();

function harness(settings: StatsSettings = { enabled: true, exclude: [], showCost: true }) {
  const { database } = temporaryStorage();
  const records = new StatsRecordRepository(database);
  const state = { settings: settings as StatsSettings | string };
  const service = new StatsReportService({
    reads: new StatsReportRepository(database),
    meta: new StatsMetaRepository(database),
    settings: () => state.settings,
    resolve: async (reference) => reference,
    now: () => NOW,
  });
  return { records, service, state };
}

/** A task of a project: its attempts are the given token counts and agent minutes. */
function addTask(
  h: ReturnType<typeof harness>,
  id: string,
  repository: string,
  parts: { tokens: number; minutes: number }[],
  finishedAt = NOW - 1000,
): void {
  parts.forEach((part, index) =>
    h.records.insertAttempts([
      attemptRecord({
        runId: id,
        seq: index + 1,
        repository,
        inputTokens: part.tokens,
        outputTokens: 0,
        durationMs: part.minutes * MINUTE,
        finishedAt,
        costUsd: 0.1,
      }),
    ]),
  );
  h.records.upsertTask(
    taskRecord({
      runId: id,
      repository,
      finishedAt,
      createdAt: finishedAt - 60 * MINUTE,
      wallMs: 60 * MINUTE,
    }),
  );
}

describe('the statistics report', () => {
  it('gives the totals and the means of a project', async () => {
    const h = harness();
    addTask(h, 't1', '/work/app', [
      { tokens: 10_000, minutes: 10 },
      { tokens: 20_000, minutes: 20 },
    ]);
    addTask(h, 't2', '/work/app', [{ tokens: 60_000, minutes: 60 }]);
    const report = await h.service.report({ repository: '/work/app' });
    expect(report.totals).toMatchObject({
      tasks: 2,
      attempts: 3,
      tokens: 90_000,
      agentMs: 90 * MINUTE,
    });
    expect(report.perTask.tokens.mean).toBe(45_000);
    expect(report.perTask.agentMs.mean).toBe(45 * MINUTE);
    expect(report.projects).toHaveLength(1);
    expect(report.outcomes).toEqual({ finished: 2, failed: 0, cancelled: 0 });
  });

  it('adds every project to the total and gives a row to each', async () => {
    const h = harness();
    addTask(h, 'a', '/work/app', [{ tokens: 90_000, minutes: 5 }]);
    addTask(h, 'b', '/work/lib', [{ tokens: 10_000, minutes: 5 }]);
    const report = await h.service.report({});
    expect(report.totals.tokens).toBe(100_000);
    expect(report.projects.map((project) => project.repository)).toEqual([
      '/work/app',
      '/work/lib',
    ]);
    expect(report.byModel).toHaveLength(1);
    expect(report.bySpecialist[0]?.key).toBe('coder');
  });

  it('hides an excluded project everywhere and keeps its records', async () => {
    const h = harness();
    addTask(h, 'a', '/work/app', [{ tokens: 90_000, minutes: 5 }]);
    addTask(h, 'b', '/work/lib', [{ tokens: 10_000, minutes: 5 }]);
    h.state.settings = { enabled: true, exclude: ['/work/lib'], showCost: true };
    const report = await h.service.report({});
    expect(report.totals.tokens).toBe(90_000);
    expect(report.projects.map((project) => project.repository)).toEqual(['/work/app']);
    expect(JSON.stringify(report.series)).not.toContain('/work/lib');
    expect((await h.service.report({ repository: '/work/lib' })).totals.tokens).toBe(0);
    h.state.settings = { enabled: true, exclude: [], showCost: true };
    expect((await h.service.report({})).totals.tokens).toBe(100_000);
  });

  it('empties the costs and keeps tokens and times when the cost is hidden', async () => {
    const h = harness({ enabled: true, exclude: [], showCost: false });
    addTask(h, 'a', '/work/app', [{ tokens: 1000, minutes: 5 }]);
    const report = await h.service.report({});
    expect(report.totals.costUsd).toBeNull();
    expect(report.perTask.costUsd).toEqual({ mean: null, median: null });
    expect(report.totals.tokens).toBe(1000);
    expect(report.totals.agentMs).toBe(5 * MINUTE);
    expect(JSON.stringify(report)).not.toMatch(/"costUsd":[0-9]/);
  });

  it('returns zeros and empty lists for an empty journal', async () => {
    const report = await harness().service.report({});
    expect(report.totals).toMatchObject({ tasks: 0, attempts: 0, tokens: 0, costUsd: 0 });
    expect(report.projects).toEqual([]);
    expect(report.series).toEqual([]);
    expect(report.perTask.tokens).toEqual({ mean: 0, median: 0 });
    expect(report.settings).toEqual({
      enabled: true,
      exclude: [],
      showCost: true,
      backfilledAt: null,
    });
  });

  it('counts a task by its attempts outside the period too, and draws every day of the period', async () => {
    const h = harness();
    const day = 86_400_000;
    h.records.insertAttempts([
      attemptRecord({
        runId: 't',
        seq: 9,
        finishedAt: NOW - 20 * day,
        inputTokens: 5000,
        outputTokens: 0,
      }),
    ]);
    addTask(h, 't', '/work/app', [{ tokens: 1000, minutes: 1 }], NOW - 1000);
    addTask(h, 'u', '/work/app', [{ tokens: 500, minutes: 1 }], NOW - 3 * day);
    const since = parseStatsPeriod('7d', NOW);
    if (!since.ok || since.since === null) throw new Error('period');
    const report = await h.service.report({ since: since.since });
    expect(report.totals.tokens).toBe(1500);
    expect(report.perTask.tokens.mean).toBe(3250);
    expect(report.series).toHaveLength(7);
    expect(report.series.filter((entry) => entry.tokens === 0)).toHaveLength(5);
    expect(sumOf(report.series)).toBe(report.totals.tokens);
  });

  it('starts the all-time series on the day of the first record', async () => {
    const h = harness();
    const yesterday = new Date(2026, 5, 9, 13).getTime();
    addTask(h, 'a', '/work/app', [{ tokens: 700, minutes: 1 }], yesterday);
    addTask(h, 'b', '/work/app', [{ tokens: 300, minutes: 1 }], NOW - 1000);
    const report = await h.service.report({});
    expect(report.series[0]?.day).toBe(dayOf(yesterday));
    expect(report.series).toHaveLength(2);
    expect(sumOf(report.series)).toBe(report.totals.tokens);
  });

  it('shows collection off when the section is invalid', async () => {
    const h = harness();
    h.state.settings = 'invalid swarm.stats';
    expect((await h.service.report({})).settings.enabled).toBe(false);
  });
});
