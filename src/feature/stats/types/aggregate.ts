import { COMMAND_RUNTIME } from '../../runs/types/index.ts';
import { type AttemptRecord, type TaskOutcome, type TaskRecord } from './records.ts';
import {
  type BreakdownRow,
  type CostStat,
  type PerTask,
  type ProjectRow,
  type SeriesDay,
  type Stat,
  type StatsReport,
  type Totals,
} from './report.ts';

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function stat(values: number[]): Stat {
  return { mean: mean(values), median: median(values) };
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const tokensOf = (record: AttemptRecord): number => record.inputTokens + record.outputTokens;

const isAgent = (record: AttemptRecord): boolean => record.runtime !== COMMAND_RUNTIME;

/** Time of agent attempts; naming calls take no time. */
const agentMsOf = (records: AttemptRecord[]): number =>
  sum(records.filter((record) => record.kind === 'step' && isAgent(record)).map(durationOf));

const durationOf = (record: AttemptRecord): number => record.durationMs;

const costOf = (records: AttemptRecord[]): number =>
  sum(records.map((record) => record.costUsd ?? 0));

/** Sums of the attempts and the tasks of one scope. */
export function totalsOf(attempts: AttemptRecord[], tasks: TaskRecord[]): Totals {
  const inputTokens = sum(attempts.map((record) => record.inputTokens));
  const outputTokens = sum(attempts.map((record) => record.outputTokens));
  return {
    tasks: tasks.length,
    attempts: attempts.length,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    costUsd: costOf(attempts),
    attemptsWithoutCost: attempts.filter((record) => record.costUsd === null).length,
    agentMs: agentMsOf(attempts),
    commandMs: sum(
      attempts
        .filter((record) => record.kind === 'step' && !isAgent(record))
        .map((record) => record.durationMs),
    ),
    wallMs: sum(tasks.map((task) => task.wallMs)),
  };
}

/** Mean and median per task; `attempts` are all the records of the tasks, whatever their period. */
export function perTaskOf(attempts: AttemptRecord[], tasks: TaskRecord[]): PerTask {
  const byRun = new Map<string, AttemptRecord[]>();
  for (const record of attempts)
    byRun.set(record.runId, [...(byRun.get(record.runId) ?? []), record]);
  const rows = tasks.map((task) => byRun.get(task.runId) ?? []);
  const costs = rows.map(costOf);
  return {
    tokens: stat(rows.map((records) => sum(records.map(tokensOf)))),
    costUsd: { mean: mean(costs), median: median(costs) },
    agentMs: stat(rows.map(agentMsOf)),
    wallMs: stat(tasks.map((task) => task.wallMs)),
  };
}

export function outcomesOf(tasks: TaskRecord[]): Record<TaskOutcome, number> {
  const outcomes: Record<TaskOutcome, number> = { finished: 0, failed: 0, cancelled: 0 };
  for (const task of tasks) outcomes[task.outcome] += 1;
  return outcomes;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

export function projectRows(
  attempts: AttemptRecord[],
  tasks: TaskRecord[],
  taskAttempts: AttemptRecord[],
): ProjectRow[] {
  const repositories = new Set([...attempts, ...tasks].map((item) => item.repository));
  return [...repositories].sort().map((repository) => {
    const ownTasks = tasks.filter((task) => task.repository === repository);
    return {
      repository,
      totals: totalsOf(
        attempts.filter((record) => record.repository === repository),
        ownTasks,
      ),
      perTask: perTaskOf(
        taskAttempts.filter((record) => record.repository === repository),
        ownTasks,
      ),
    };
  });
}

/** Rows by a field of the attempts, the biggest consumers of tokens first. */
export function breakdownRows(
  attempts: AttemptRecord[],
  key: (record: AttemptRecord) => string,
): BreakdownRow[] {
  const rows = [...groupBy(attempts, key)].map(([name, records]) => {
    const inputTokens = sum(records.map((record) => record.inputTokens));
    const outputTokens = sum(records.map((record) => record.outputTokens));
    return {
      key: name,
      attempts: records.length,
      inputTokens,
      outputTokens,
      tokens: inputTokens + outputTokens,
      costUsd: costOf(records),
      agentMs: agentMsOf(records),
      tokensPerAttempt: (inputTokens + outputTokens) / records.length,
    };
  });
  return rows.sort(
    (left, right) => right.tokens - left.tokens || left.key.localeCompare(right.key, 'en'),
  );
}

/** The local day of a moment as `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Next local midnight; a day is not always 24 hours. */
function nextMidnight(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/**
 * One entry per local day from `from` to `to` (inclusive); days without data hold zeros. Attempts
 * count on the day they ended and tasks on the day they finished.
 */
export function dailySeries(
  attempts: AttemptRecord[],
  tasks: TaskRecord[],
  from: number,
  to: number,
): SeriesDay[] {
  const attemptDays = groupBy(attempts, (record) => dayOf(record.finishedAt));
  const taskDays = groupBy(tasks, (task) => dayOf(task.finishedAt));
  const days: SeriesDay[] = [];
  const last = startOfDay(to);
  // The day that holds `from` is included, so the series covers every record of the period.
  for (let cursor = startOfDay(from); cursor <= last;) {
    const day = dayOf(cursor);
    const records = attemptDays.get(day) ?? [];
    const finished = taskDays.get(day) ?? [];
    const repositories = [...new Set([...records, ...finished].map((item) => item.repository))];
    days.push({
      day,
      start: cursor,
      tokens: sum(records.map(tokensOf)),
      costUsd: costOf(records),
      agentMs: agentMsOf(records),
      tasks: finished.length,
      projects: repositories.sort().map((repository) => {
        const own = records.filter((record) => record.repository === repository);
        return {
          repository,
          tokens: sum(own.map(tokensOf)),
          costUsd: costOf(own),
          agentMs: agentMsOf(own),
          tasks: finished.filter((task) => task.repository === repository).length,
        };
      }),
    });
    cursor = nextMidnight(cursor);
  }
  return days;
}

/** The report with every cost field null: tokens and times stay. */
export function maskCosts(report: StatsReport): StatsReport {
  const noCost = (): CostStat => ({ mean: null, median: null });
  const totals = (value: Totals): Totals => ({ ...value, costUsd: null });
  const perTask = (value: PerTask): PerTask => ({ ...value, costUsd: noCost() });
  const row = <T extends { costUsd: number | null }>(value: T): T => ({ ...value, costUsd: null });
  return {
    ...report,
    totals: totals(report.totals),
    perTask: perTask(report.perTask),
    projects: report.projects.map((project) => ({
      ...project,
      totals: totals(project.totals),
      perTask: perTask(project.perTask),
    })),
    bySpecialist: report.bySpecialist.map(row),
    byModel: report.byModel.map(row),
    byPipeline: report.byPipeline.map(row),
    byRuntime: report.byRuntime.map(row),
    series: report.series.map((day) => ({
      ...row(day),
      projects: day.projects.map(row),
    })),
  };
}
