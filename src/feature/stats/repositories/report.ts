import type { Database, Row } from '../../../platform/sqlite/index.ts';
import {
  type AttemptRecord,
  type AttemptKind,
  type TaskOutcome,
  type TaskRecord,
} from '../types/index.ts';

/** What a read of the journal covers. */
export interface Scope {
  since?: number;
  until?: number;
  repository?: string;
  /** Roots of the projects left out of every read. */
  exclude: readonly string[];
}

const CHUNK = 400;

function where(scope: Scope): { sql: string; values: (string | number)[] } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (scope.since !== undefined) {
    clauses.push('finished_at >= ?');
    values.push(scope.since);
  }
  if (scope.until !== undefined) {
    clauses.push('finished_at <= ?');
    values.push(scope.until);
  }
  if (scope.repository !== undefined) {
    clauses.push('repository = ?');
    values.push(scope.repository);
  }
  if (scope.exclude.length > 0) {
    clauses.push(`repository NOT IN (${scope.exclude.map(() => '?').join(', ')})`);
    values.push(...scope.exclude);
  }
  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, values };
}

const ATTEMPT_COLUMNS = `run_id, group_slug, seq, kind, repository, pipeline, step_id, specialist, runtime,
  model, status, reason, started_at, finished_at, duration_ms, input_tokens, output_tokens, cost_usd`;

function attemptOf(row: Row): AttemptRecord {
  return {
    runId: String(row.run_id),
    group: String(row.group_slug),
    seq: Number(row.seq),
    kind: String(row.kind) as AttemptKind,
    repository: String(row.repository),
    pipeline: String(row.pipeline),
    stepId: String(row.step_id),
    specialist: String(row.specialist),
    runtime: String(row.runtime),
    model: row.model === null ? null : String(row.model),
    status: String(row.status),
    reason: row.reason === null ? null : String(row.reason),
    startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at),
    durationMs: Number(row.duration_ms),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  };
}

function taskOf(row: Row): TaskRecord {
  return {
    runId: String(row.run_id),
    repository: String(row.repository),
    pipeline: String(row.pipeline),
    createdAt: Number(row.created_at),
    finishedAt: Number(row.finished_at),
    wallMs: Number(row.wall_ms),
    outcome: String(row.outcome) as TaskOutcome,
  };
}

/** Reads of the journal for the report. */
export class StatsReportRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Attempts that ended in the period. */
  attempts(scope: Scope): AttemptRecord[] {
    const { sql, values } = where(scope);
    return this.database
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM stats_attempts${sql} ORDER BY finished_at, run_id, seq`,
      )
      .all(...values)
      .map(attemptOf);
  }

  /** Tasks that finished in the period. */
  tasks(scope: Scope): TaskRecord[] {
    const { sql, values } = where(scope);
    return this.database
      .prepare(
        `SELECT run_id, repository, pipeline, created_at, finished_at, wall_ms, outcome
         FROM stats_runs${sql} ORDER BY finished_at, run_id`,
      )
      .all(...values)
      .map(taskOf);
  }

  /** Every record of the given runs, whatever the period. */
  attemptsOfRuns(runIds: string[]): AttemptRecord[] {
    const result: AttemptRecord[] = [];
    for (let start = 0; start < runIds.length; start += CHUNK) {
      const chunk = runIds.slice(start, start + CHUNK);
      const rows = this.database
        .prepare(
          `SELECT ${ATTEMPT_COLUMNS} FROM stats_attempts WHERE run_id IN (${chunk.map(() => '?').join(', ')})`,
        )
        .all(...chunk);
      result.push(...rows.map(attemptOf));
    }
    return result;
  }

  /** The earliest moment an attempt or a task of the journal ended; null for an empty journal. */
  firstFinished(exclude: readonly string[]): number | null {
    const { sql, values } = where({ exclude });
    const row = this.database
      .prepare(
        `SELECT MIN(first) AS first FROM (
           SELECT MIN(finished_at) AS first FROM stats_attempts${sql}
           UNION ALL SELECT MIN(finished_at) AS first FROM stats_runs${sql})`,
      )
      .get(...values, ...values) as Row | undefined;
    return row && row.first !== null ? Number(row.first) : null;
  }
}
