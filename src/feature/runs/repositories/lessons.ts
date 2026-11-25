import { createHash } from 'node:crypto';

import type { Database, Row } from '../../../platform/sqlite/index.ts';
import type { RunState } from '../types/index.ts';

import { hydrateRun } from './rows.ts';

/**
 * A cheap fingerprint of the finished runs of a repository: it changes when one finishes and when
 * the delivery of a run in the window changes (a delivery of a finished run is applied later).
 */
export interface LessonsVersion {
  count: number;
  lastFinishedAt: number;
  /** Hash of the deliveries of the runs in the window: a delivery changes after a run finished. */
  deliveries: string;
}

/** The finished runs the lessons of a specialist are built from. */
export class LessonsRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** The last finished runs of a repository, newest first. */
  finishedRuns(repository: string, limit: number): RunState[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM runs
         WHERE repository = ? AND finished_at IS NOT NULL AND probe_of IS NULL
         ORDER BY finished_at DESC, id
         LIMIT ?`,
      )
      .all(repository, limit) as Row[];
    return rows.map((row) => hydrateRun(this.database, row));
  }

  /**
   * The fingerprint of the finished runs of a repository: the lessons read the whole history of
   * the repository, so they reload it only when the history changed. The delivery of a finished
   * run changes without a new run (`aip run apply`, `aip run mark-delivered`), and the lessons read
   * it, so the fingerprint covers the deliveries of the window as well.
   */
  version(repository: string, limit: number): LessonsVersion {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count, MAX(finished_at) AS last FROM runs
         WHERE repository = ? AND finished_at IS NOT NULL AND probe_of IS NULL`,
      )
      .get(repository) as { count: number; last: number | null };
    return {
      count: Number(row.count),
      lastFinishedAt: Number(row.last ?? 0),
      deliveries: this.deliveryFingerprint(repository, limit),
    };
  }

  /** The deliveries of the groups of the runs the lessons are built from, hashed. */
  private deliveryFingerprint(repository: string, limit: number): string {
    const rows = this.database
      .prepare(
        `SELECT g.run_id AS run, g.slug AS slug, g.delivery_json AS delivery FROM groups g
         JOIN (SELECT id FROM runs
               WHERE repository = ? AND finished_at IS NOT NULL AND probe_of IS NULL
               ORDER BY finished_at DESC, id
               LIMIT ?) AS recent ON recent.id = g.run_id
         ORDER BY g.run_id, g.slug`,
      )
      .all(repository, limit) as Row[];
    const hash = createHash('sha256');
    for (const row of rows) {
      hash.update(
        `${String(row.run)}\u0000${String(row.slug)}\u0000${String(row.delivery ?? '')}\n`,
      );
    }
    return hash.digest('hex');
  }
}
