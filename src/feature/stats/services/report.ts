import { resolve as resolvePath } from 'node:path';

import type { StatsSettings } from '../../swarm-config/types/index.ts';
import type { StatsMetaRepository, StatsReportRepository } from '../repositories/index.ts';
import {
  type StatsQuery,
  type StatsReport,
  breakdownRows,
  dailySeries,
  maskCosts,
  outcomesOf,
  perTaskOf,
  projectRows,
  totalsOf,
} from '../types/index.ts';

export interface ReportDependencies {
  reads: StatsReportRepository;
  meta: StatsMetaRepository;
  settings: () => StatsSettings | string;
  resolve: (reference: string) => Promise<string>;
  now: () => number;
}

/** The longest series a report draws. */
const MAX_SERIES_DAYS = 3660;
const DAY_MS = 86_400_000;

/** Builds the report of the journal; the clients draw it as it is. */
export class StatsReportService {
  private readonly dependencies: ReportDependencies;

  constructor(dependencies: ReportDependencies) {
    this.dependencies = dependencies;
  }

  async report(query: StatsQuery): Promise<StatsReport> {
    const { reads, meta, now } = this.dependencies;
    const read = this.dependencies.settings();
    const settings: StatsSettings =
      typeof read === 'string' ? { enabled: false, exclude: [], showCost: true } : read;
    const exclude = await Promise.all(settings.exclude.map((path) => this.rootOf(path)));
    const repository =
      query.repository === undefined ? undefined : await this.rootOf(query.repository);
    const scope = {
      ...(query.since === undefined ? {} : { since: query.since }),
      ...(query.until === undefined ? {} : { until: query.until }),
      ...(repository === undefined ? {} : { repository }),
      exclude,
    };
    const attempts = reads.attempts(scope);
    const tasks = reads.tasks(scope);
    const taskAttempts = reads.attemptsOfRuns(tasks.map((task) => task.runId));
    const end = query.until ?? now();
    const first = query.since ?? reads.firstFinished(exclude);
    const start = first === null ? null : Math.max(first, end - MAX_SERIES_DAYS * DAY_MS);
    const report: StatsReport = {
      settings: {
        enabled: settings.enabled,
        exclude: settings.exclude,
        showCost: settings.showCost,
        backfilledAt: meta.backfilledAt(),
      },
      since: query.since ?? null,
      until: query.until ?? null,
      repository: repository ?? null,
      totals: totalsOf(attempts, tasks),
      perTask: perTaskOf(taskAttempts, tasks),
      outcomes: outcomesOf(tasks),
      projects: projectRows(attempts, tasks, taskAttempts),
      bySpecialist: breakdownRows(attempts, (record) => record.specialist),
      byModel: breakdownRows(attempts, (record) => record.model ?? 'unknown'),
      byPipeline: breakdownRows(attempts, (record) => record.pipeline),
      byRuntime: breakdownRows(attempts, (record) => record.runtime),
      series: start === null ? [] : dailySeries(attempts, tasks, start, end),
    };
    return settings.showCost ? report : maskCosts(report);
  }

  private rootOf(path: string): Promise<string> {
    return this.dependencies.resolve(path).catch(() => resolvePath(path));
  }
}
