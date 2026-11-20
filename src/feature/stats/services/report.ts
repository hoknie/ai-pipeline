import { resolve as resolvePath } from 'node:path';

import {
  findAction,
  findPipeline,
  findSpecialist,
  type ResolvedConfig,
  type StatsSettings,
} from '../../swarm-config/types/index.ts';
import type { StatsMetaRepository, StatsReportRepository } from '../repositories/index.ts';
import {
  type AttemptRecord,
  type StatsQuery,
  type StatsReport,
  breakdownNames,
  breakdownRows,
  bucketSeries,
  outcomesOf,
  perTaskOf,
  projectRows,
  resolveBucket,
  totalsOf,
  NO_AUTHOR,
  UNKNOWN_MODEL,
} from '../types/index.ts';

export interface ReportDependencies {
  reads: StatsReportRepository;
  meta: StatsMetaRepository;
  settings: () => StatsSettings | string;
  resolve: (reference: string) => Promise<string>;
  /** Configuration of a project; null when it cannot be loaded. */
  config: (repository: string) => ResolvedConfig | null;
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
      typeof read === 'string' ? { enabled: false, exclude: [] } : read;
    const exclude = await Promise.all(settings.exclude.map((path) => this.rootOf(path)));
    const repository =
      query.repository === undefined ? undefined : await this.rootOf(query.repository);
    const scope = {
      ...(query.since === undefined ? {} : { since: query.since }),
      ...(query.until === undefined ? {} : { until: query.until }),
      ...(repository === undefined ? {} : { repository }),
      exclude,
      ...(query.only === undefined ? {} : { only: query.only }),
      ...(query.author === undefined ? {} : { author: query.author }),
    };
    const attempts = reads.attempts(scope);
    const tasks = reads.tasks(scope);
    const taskAttempts = reads.attemptsOfRuns(tasks.map((task) => task.runId));
    const configs = new Map<string, ResolvedConfig | null>();
    const configOf = (project: string): ResolvedConfig | null => {
      if (!configs.has(project)) configs.set(project, this.dependencies.config(project));
      return configs.get(project) ?? null;
    };
    const specialistKey = (record: AttemptRecord): string => record.specialist;
    const pipelineKey = (record: AttemptRecord): string => record.pipeline;
    const specialistNames = breakdownNames(attempts, specialistKey, (project, key) => {
      const config = configOf(project);
      if (config === null) return null;
      return findSpecialist(config, key)?.name ?? findAction(config, key)?.name ?? null;
    });
    const pipelineNames = breakdownNames(attempts, pipelineKey, (project, key) => {
      const config = configOf(project);
      return config === null ? null : (findPipeline(config, key)?.name ?? null);
    });
    const end = query.until ?? now();
    const first = query.since ?? reads.firstFinished(exclude, query.only);
    const start = first === null ? null : Math.max(first, end - MAX_SERIES_DAYS * DAY_MS);
    const bucket = resolveBucket(start, end, query.bucket);
    const report: StatsReport = {
      settings: {
        enabled: settings.enabled,
        exclude: settings.exclude,
        backfilledAt: meta.backfilledAt(),
      },
      since: query.since ?? null,
      until: query.until ?? null,
      repository: repository ?? null,
      bucket,
      totals: totalsOf(attempts, tasks),
      perTask: perTaskOf(taskAttempts, tasks),
      outcomes: outcomesOf(tasks),
      projects: projectRows(attempts, tasks, taskAttempts),
      bySpecialist: breakdownRows(attempts, specialistKey, specialistNames),
      byModel: breakdownRows(attempts, (record) => record.model ?? UNKNOWN_MODEL),
      byPipeline: breakdownRows(attempts, pipelineKey, pipelineNames),
      byRuntime: breakdownRows(attempts, (record) => record.runtime),
      ...(query.byAuthor === true
        ? { byAuthor: breakdownRows(attempts, (record) => record.author ?? NO_AUTHOR) }
        : {}),
      series: start === null ? [] : bucketSeries(attempts, tasks, start, end, bucket),
    };
    return report;
  }

  private rootOf(path: string): Promise<string> {
    return this.dependencies.resolve(path).catch(() => resolvePath(path));
  }
}
