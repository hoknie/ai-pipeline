import { DELIVERY_MODES } from '../../swarm-config/types/index.ts';
import { ON_LIMIT_MODES } from '../../runs/types/index.ts';
import type { Database, Row } from '../../../platform/sqlite/index.ts';
import { json, nullable, parse, text } from '../../../platform/sqlite/index.ts';
import type { Queue, QueueItem } from '../types/index.ts';

export class QueueRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  loadQueue(repository: string): Queue | null {
    const row = this.database
      .prepare('SELECT * FROM queues WHERE repository = ?')
      .get(repository) as Row | undefined;
    return row ? this.hydrateQueue(row) : null;
  }

  queues(): Queue[] {
    const rows = this.database.prepare('SELECT * FROM queues ORDER BY repository').all() as Row[];
    return rows.map((row) => this.hydrateQueue(row));
  }

  /** The largest task number among the queue items of the repository; 0 when none. */
  maxItemNumber(repository: string): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(number), 0) AS max FROM queue_items WHERE repository = ?')
      .get(repository) as { max: number };
    return Number(row.max);
  }

  /** One statement, no transaction of its own: the scenario of removing a tag opens it. */
  dropItemTag(repository: string, id: string): void {
    this.database
      .prepare(
        `UPDATE queue_items SET tags_json = (SELECT json_group_array(value) FROM json_each(tags_json) WHERE value <> ?)
         WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)`,
      )
      .run(id, repository, id);
  }

  /** No transaction of its own: the queue of a project that moved gets its new path. */
  moveQueue(from: string, to: string): void {
    this.database.exec('PRAGMA defer_foreign_keys = ON');
    this.database
      .prepare('UPDATE queue_items SET repository = ? WHERE repository = ?')
      .run(to, from);
    this.database.prepare('UPDATE queues SET repository = ? WHERE repository = ?').run(to, from);
  }

  saveQueue(queue: Queue): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO queues (repository, status, parallel, runs_json, acknowledged_json, stop_json, updated_at, autopilot, skip_failed, skipped_json, autopilot_answer, on_limit, next_number, priority_json, auto_answer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (repository) DO UPDATE SET status = excluded.status, parallel = excluded.parallel, runs_json = excluded.runs_json, acknowledged_json = excluded.acknowledged_json, stop_json = excluded.stop_json, updated_at = excluded.updated_at, autopilot = excluded.autopilot, skip_failed = excluded.skip_failed, skipped_json = excluded.skipped_json, autopilot_answer = excluded.autopilot_answer, on_limit = excluded.on_limit, next_number = excluded.next_number, priority_json = excluded.priority_json, auto_answer = excluded.auto_answer`,
        )
        .run(
          queue.repository,
          queue.status,
          queue.parallel,
          JSON.stringify(queue.runs),
          JSON.stringify(queue.acknowledged),
          json(queue.stop),
          queue.updatedAt,
          queue.autopilot ? 1 : 0,
          queue.skipFailed ? 1 : 0,
          JSON.stringify(queue.skipped),
          queue.autopilotAnswer,
          queue.onLimit,
          queue.nextNumber,
          JSON.stringify(queue.priority),
          queue.autoAnswer ? 1 : 0,
        );
      this.database.prepare('DELETE FROM queue_items WHERE repository = ?').run(queue.repository);
      const insert = this.database.prepare(
        `INSERT INTO queue_items (id, repository, position, pipeline, task, groups_json, title, error, created_at, auto_deliver, tags_json, skip_json, after_json, delivery_mode, run_id, postponed, number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      queue.items.forEach((item, position) =>
        insert.run(
          item.id,
          queue.repository,
          position,
          item.pipeline,
          item.task,
          json(item.groups),
          item.title,
          item.error,
          item.createdAt,
          item.autoDeliver === null ? null : item.autoDeliver ? 1 : 0,
          JSON.stringify(item.tags),
          JSON.stringify(item.skip),
          JSON.stringify(item.after),
          item.deliveryMode,
          item.run,
          item.postponed ? 1 : 0,
          item.number,
        ),
      );
    });
  }

  private hydrateQueue(row: Row): Queue {
    const repository = String(row.repository);
    const items = this.database
      .prepare('SELECT * FROM queue_items WHERE repository = ? ORDER BY position')
      .all(repository) as Row[];
    return {
      repository,
      status: String(row.status) as Queue['status'],
      parallel: Number(row.parallel),
      autopilot: Number(row.autopilot ?? 0) === 1,
      autoAnswer: Number(row.auto_answer ?? 0) === 1,
      skipFailed: Number(row.skip_failed ?? 0) === 1,
      skipped: row.skipped_json ? parse(row.skipped_json) : [],
      autopilotAnswer: text(row.autopilot_answer ?? null),
      onLimit: ON_LIMIT_MODES.find((mode) => mode === row.on_limit) ?? 'wait',
      nextNumber: Number(row.next_number ?? 1),
      priority: row.priority_json ? parse(row.priority_json) : [],
      items: items.map(hydrateItem),
      runs: parse(row.runs_json ?? null),
      acknowledged: parse(row.acknowledged_json ?? null),
      stop: nullable(row.stop_json ?? null),
      updatedAt: Number(row.updated_at),
    };
  }
}

function hydrateItem(item: Row): QueueItem {
  return {
    id: String(item.id),
    number: Number(item.number),
    pipeline: String(item.pipeline),
    task: text(item.task ?? null),
    groups: nullable(item.groups_json ?? null),
    title: text(item.title ?? null),
    autoDeliver:
      item.auto_deliver === null || item.auto_deliver === undefined
        ? null
        : Number(item.auto_deliver) === 1,
    deliveryMode: DELIVERY_MODES.find((mode) => mode === item.delivery_mode) ?? null,
    tags: item.tags_json ? parse(item.tags_json) : [],
    skip: item.skip_json ? parse(item.skip_json) : [],
    after: item.after_json ? parse(item.after_json) : [],
    postponed: Number(item.postponed ?? 0) === 1,
    createdAt: Number(item.created_at),
    error: text(item.error ?? null),
    run: text(item.run_id ?? null),
  };
}
