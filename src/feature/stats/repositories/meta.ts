import type { Database, Row } from '../../../platform/sqlite/index.ts';

/** The single row of `stats_meta`. */
export class StatsMetaRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** When the accumulated history was moved into the journal; null before that. */
  backfilledAt(): number | null {
    const row = this.database.prepare('SELECT backfilled_at FROM stats_meta WHERE id = 1').get() as
      Row | undefined;
    return row && row.backfilled_at !== null ? Number(row.backfilled_at) : null;
  }

  /** When the authors of the old records were filled in; null before that. */
  authorBackfilledAt(): number | null {
    const row = this.database
      .prepare('SELECT author_backfilled_at FROM stats_meta WHERE id = 1')
      .get() as Row | undefined;
    return row && row.author_backfilled_at !== null ? Number(row.author_backfilled_at) : null;
  }

  markAuthorBackfilled(at: number): void {
    this.database.prepare('UPDATE stats_meta SET author_backfilled_at = ? WHERE id = 1').run(at);
  }

  markBackfilled(at: number): void {
    this.database
      .prepare(
        `INSERT INTO stats_meta (id, backfilled_at) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET backfilled_at = excluded.backfilled_at`,
      )
      .run(at);
  }
}
