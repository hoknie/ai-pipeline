import type { Database, Row } from '../../../platform/sqlite/index.ts';
import type { RunState } from '../types/index.ts';

import { hydrateRun } from './rows.ts';
import { writeRunRows } from './write.ts';

export class RunRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Writes the run with its groups and attempts in one transaction. */
  saveRun(state: RunState): void {
    this.database.transaction(() => this.writeRun(state));
  }

  /** The same write without a transaction of its own, for a scenario that opened one. */
  writeRun(state: RunState): void {
    writeRunRows(this.database, state);
  }

  loadRun(id: string): RunState | null {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? hydrateRun(this.database, row) : null;
  }

  /** The run that started from queue item `item` in the repository, if any. */
  runOfQueueItem(repository: string, item: string): RunState | null {
    const row = this.database
      .prepare('SELECT * FROM runs WHERE repository = ? AND queue_item = ? LIMIT 1')
      .get(repository, item) as Row | undefined;
    return row ? hydrateRun(this.database, row) : null;
  }

  activeRuns(): RunState[] {
    const rows = this.database
      .prepare('SELECT * FROM runs WHERE finished_at IS NULL ORDER BY created_at, id')
      .all() as Row[];
    return rows.map((row) => hydrateRun(this.database, row));
  }

  /** Finished runs whose delivery had not finished. */
  deliveringRuns(): RunState[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM runs WHERE finished_at IS NOT NULL AND pending_delivery_json IS NOT NULL ORDER BY created_at, id',
      )
      .all() as Row[];
    return rows.map((row) => hydrateRun(this.database, row));
  }

  /** Ids of the runs with an attempt that ran out of a usage limit. */
  limitedRunIds(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT run_id FROM attempts WHERE reason_json LIKE '%"usage_limit"%' ORDER BY run_id`,
      )
      .all() as Row[];
    return rows.map((row) => String(row.run_id));
  }

  /** The largest task number among the runs of the repository; 0 when none. */
  maxNumber(repository: string): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(number), 0) AS max FROM runs WHERE repository = ?')
      .get(repository) as { max: number };
    return Number(row.max);
  }

  /** The id of the run of the repository with this task number; null when there is none. */
  runIdByNumber(repository: string, number: number): string | null {
    const row = this.database
      .prepare('SELECT id FROM runs WHERE repository = ? AND number = ?')
      .get(repository, number) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * One statement, no transaction of its own: takes the tag off every run of the repository,
   * finished too. The scenario of removing a tag opens the transaction.
   */
  dropTag(repository: string, id: string): void {
    this.database
      .prepare(
        `UPDATE runs SET tags_json = (SELECT json_group_array(value) FROM json_each(tags_json) WHERE value <> ?)
         WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)`,
      )
      .run(id, repository, id);
  }
}
