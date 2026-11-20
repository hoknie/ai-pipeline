import type { Database } from '../../../platform/sqlite/index.ts';
import type { Attempt, AttemptRecord } from '../types/index.ts';

interface Row {
  delivery_id: number;
  n: number;
  started_at: number;
  duration_ms: number;
  status_code: number | null;
  error_kind: string | null;
  response_excerpt: string | null;
}

/** The longest excerpt of an answer that is kept. */
export const EXCERPT_LIMIT = 1024;

/** The table `notification_attempts`; deliveries take their attempts along when they are deleted. */
export class AttemptRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Records the next attempt of a delivery. */
  insert(deliveryId: number, attempt: AttemptRecord): void {
    this.database
      .prepare(
        `INSERT INTO notification_attempts
         (delivery_id, n, started_at, duration_ms, status_code, error_kind, response_excerpt)
         VALUES (?, (SELECT COALESCE(MAX(n), 0) + 1 FROM notification_attempts WHERE delivery_id = ?),
                 ?, ?, ?, ?, ?)`,
      )
      .run(
        deliveryId,
        deliveryId,
        attempt.startedAt,
        Math.round(attempt.durationMs),
        attempt.statusCode,
        attempt.errorKind,
        attempt.excerpt === null ? null : attempt.excerpt.slice(0, EXCERPT_LIMIT),
      );
  }

  /** The attempts of a delivery, the first one first. */
  ofDelivery(deliveryId: number): Attempt[] {
    const rows = this.database
      .prepare('SELECT * FROM notification_attempts WHERE delivery_id = ? ORDER BY n')
      .all(deliveryId) as unknown as Row[];
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      n: row.n,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      statusCode: row.status_code,
      errorKind: row.error_kind,
      excerpt: row.response_excerpt,
    }));
  }
}
