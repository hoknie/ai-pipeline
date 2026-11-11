import type { Database } from '../../../platform/sqlite/index.ts';
import { type AttemptRecord, type TaskRecord } from '../types/index.ts';

/** Writes of the journal: the rows of `stats_attempts` and `stats_runs`. */
export class StatsRecordRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Runs `work` in one transaction; `work` calls no method that opens its own. */
  transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }

  /** Adds the attempts that are not there yet; returns how many rows are new. */
  insertAttempts(records: AttemptRecord[]): number {
    const statement = this.database.prepare(
      `INSERT OR IGNORE INTO stats_attempts (run_id, group_slug, seq, kind, repository, pipeline, step_id,
         specialist, runtime, model, status, reason, started_at, finished_at, duration_ms,
         input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    for (const record of records) {
      const result = statement.run(
        record.runId,
        record.group,
        record.seq,
        record.kind,
        record.repository,
        record.pipeline,
        record.stepId,
        record.specialist,
        record.runtime,
        record.model,
        record.status,
        record.reason,
        record.startedAt,
        record.finishedAt,
        record.durationMs,
        record.inputTokens,
        record.outputTokens,
        record.costUsd,
      );
      added += Number(result.changes);
    }
    return added;
  }

  /** Adds the task or replaces its earlier record. */
  upsertTask(task: TaskRecord): void {
    this.database
      .prepare(
        `INSERT INTO stats_runs (run_id, repository, pipeline, created_at, finished_at, wall_ms, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET repository = excluded.repository,
           pipeline = excluded.pipeline, created_at = excluded.created_at,
           finished_at = excluded.finished_at, wall_ms = excluded.wall_ms, outcome = excluded.outcome`,
      )
      .run(
        task.runId,
        task.repository,
        task.pipeline,
        task.createdAt,
        task.finishedAt,
        task.wallMs,
        task.outcome,
      );
  }

  /** Removes every record of the project; returns the number of rows removed. */
  deleteRepository(repository: string): number {
    const attempts = this.database
      .prepare('DELETE FROM stats_attempts WHERE repository = ?')
      .run(repository);
    const tasks = this.database
      .prepare('DELETE FROM stats_runs WHERE repository = ?')
      .run(repository);
    return Number(attempts.changes) + Number(tasks.changes);
  }
}
