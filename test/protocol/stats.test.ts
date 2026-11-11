import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { StatsReport } from '../../src/feature/stats/types/index.ts';
import {
  requestSchema,
  statsClearSchema,
  statsReportSchema,
} from '../../src/presentation/ipc/contract/index.ts';
import {
  formatCost,
  formatSpan,
  formatStats,
  formatTokens,
} from '../../src/presentation/format/index.ts';
import { statsView } from '../../src/presentation/ipc/views/stats.ts';
import { attemptRecord, taskRecord } from '../feature/stats/helpers.ts';
import {
  breakdownRows,
  dailySeries,
  outcomesOf,
  perTaskOf,
  projectRows,
  totalsOf,
} from '../../src/feature/stats/types/index.ts';

describe('statistics IPC contract', () => {
  it('has a response schema that is the report of the feature', () => {
    expectTypeOf<z.infer<typeof statsReportSchema>>().toEqualTypeOf<StatsReport>();
    expectTypeOf<z.infer<typeof statsClearSchema>>().toEqualTypeOf<{ removed: number }>();
  });

  it('accepts a period and a project, and an empty request', () => {
    for (const params of [{}, { since: 1 }, { since: 1, until: 2, repository: '/work/app' }]) {
      expect(requestSchema.safeParse({ method: 'stats_report', params }).success).toBe(true);
    }
    expect(requestSchema.safeParse({ method: 'stats_report' }).success).toBe(true);
    expect(
      requestSchema.safeParse({ method: 'stats_clear', params: { repository: '/work/app' } })
        .success,
    ).toBe(true);
  });

  it('rejects wrong moments, a reversed period and a missing project', () => {
    for (const params of [
      { since: 'abc' },
      { since: -1 },
      { since: 1.5 },
      { since: 5, until: 5 },
      { since: 9, until: 3 },
      { repository: '' },
    ]) {
      expect(requestSchema.safeParse({ method: 'stats_report', params }).success).toBe(false);
    }
    expect(requestSchema.safeParse({ method: 'stats_clear', params: {} }).success).toBe(false);
  });
});

function sampleReport(): StatsReport {
  const attempts = [
    attemptRecord({
      runId: 'a',
      inputTokens: 12_000,
      outputTokens: 3_000,
      costUsd: 0.42,
      durationMs: 90 * 60_000,
    }),
    attemptRecord({
      runId: 'b',
      repository: '/work/lib',
      inputTokens: 2_500_000,
      outputTokens: 0,
      costUsd: null,
    }),
  ];
  const tasks = [
    taskRecord({ runId: 'a' }),
    taskRecord({ runId: 'b', repository: '/work/lib', outcome: 'failed' }),
  ];
  return {
    settings: { enabled: true, exclude: [], showCost: true, backfilledAt: 1 },
    since: null,
    until: null,
    repository: null,
    totals: totalsOf(attempts, tasks),
    perTask: perTaskOf(attempts, tasks),
    outcomes: outcomesOf(tasks),
    projects: projectRows(attempts, tasks, attempts),
    bySpecialist: breakdownRows(attempts, (record) => record.specialist),
    byModel: breakdownRows(attempts, (record) => record.model ?? 'unknown'),
    byPipeline: breakdownRows(attempts, (record) => record.pipeline),
    byRuntime: breakdownRows(attempts, (record) => record.runtime),
    series: dailySeries(attempts, tasks, 1000, 2000),
  };
}

describe('statistics view and text', () => {
  it('passes the report through the view and validates against the schema', () => {
    const report = sampleReport();
    const view = statsView(report);
    expect(statsReportSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(report);
  });

  it('formats tokens, spans and costs', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_500)).toBe('12.5k');
    expect(formatTokens(3_200_000)).toBe('3.2M');
    expect(formatTokens(2_000)).toBe('2k');
    expect(formatSpan(90 * 60_000)).toBe('1h 30m');
    expect(formatSpan(45 * 60_000)).toBe('45m');
    expect(formatSpan(2 * 3_600_000)).toBe('2h');
    expect(formatSpan(30_000)).toBe('30s');
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(null)).toBe('—');
  });

  it('prints the totals, a row per project and the tables', () => {
    const text = formatStats(sampleReport());
    expect(text).toContain('all time · all projects');
    expect(text).toContain('Tasks 2 (finished 1, failed 1, cancelled 0)');
    expect(text).toContain('Tokens 2.5M');
    expect(text).toMatch(/per task\s+mean\s+median/);
    expect(text).toMatch(/project\s+tasks\s+tokens/);
    expect(text).toContain('/work/app');
    expect(text).toContain('/work/lib');
    for (const title of ['specialist', 'model', 'pipeline', 'runtime']) {
      expect(text).toMatch(new RegExp(`${title}\\s+attempts`));
    }
    expect(text).not.toContain('Collection is off');
  });

  it('starts with a note when collection is off and shows dashes without a cost', () => {
    const report = sampleReport();
    const text = formatStats({
      ...report,
      settings: { ...report.settings, enabled: false },
      totals: { ...report.totals, costUsd: null },
    });
    expect(text.split('\n')[0]).toContain('Collection is off');
    expect(text).toContain('cost —');
  });
});
