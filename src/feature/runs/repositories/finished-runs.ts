import type { Database, Row } from '../../../platform/sqlite/index.ts';
import type { RunState } from '../types/index.ts';

import { hydrateRun } from './rows.ts';
import type { RunRepository } from './runs.ts';

const RECENT_FINISHED = 10;

export class FinishedRunRepository {
  private readonly database: Database;
  private readonly runs: RunRepository;

  constructor(database: Database, runs: RunRepository) {
    this.database = database;
    this.runs = runs;
  }

  finishedRuns(): RunState[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC',
      )
      .all() as Row[];
    return rows.map((row) => hydrateRun(this.database, row));
  }

  recentRuns(limit = RECENT_FINISHED): RunState[] {
    const finished = this.database
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all(limit) as Row[];
    return [...this.runs.activeRuns(), ...finished.map((row) => hydrateRun(this.database, row))];
  }

  /**
   * A page of finished runs, newest created first, strictly after the cursor `before`;
   * `more` tells whether older finished runs remain.
   */
  finishedRunsPage(
    limit: number,
    before?: { createdAt: number; id: string },
  ): { runs: RunState[]; more: boolean } {
    const rows = (
      before
        ? this.database
            .prepare(
              `SELECT * FROM runs WHERE finished_at IS NOT NULL
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .all(before.createdAt, before.createdAt, before.id, limit + 1)
        : this.database
            .prepare(
              'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?',
            )
            .all(limit + 1)
    ) as Row[];
    return {
      runs: rows.slice(0, limit).map((row) => hydrateRun(this.database, row)),
      more: rows.length > limit,
    };
  }
}
