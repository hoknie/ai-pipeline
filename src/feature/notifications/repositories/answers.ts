import type { Database } from '../../../platform/sqlite/index.ts';
import type { Draft } from '../types/index.ts';

/** The table `notification_answers`: the answers collected in a chat before they are all given. */
export class AnswerRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  all(deliveryId: number): Draft[] {
    const rows = this.database
      .prepare(
        'SELECT question_index, answer FROM notification_answers WHERE delivery_id = ? ORDER BY question_index',
      )
      .all(deliveryId) as unknown as { question_index: number; answer: string }[];
    return rows.map((row) => ({ index: row.question_index, answer: row.answer }));
  }

  set(deliveryId: number, index: number, answer: string, user: string, now: number): void {
    this.database
      .prepare(
        `INSERT INTO notification_answers (delivery_id, question_index, answer, user_ref, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (delivery_id, question_index)
         DO UPDATE SET answer = excluded.answer, user_ref = excluded.user_ref, updated_at = excluded.updated_at`,
      )
      .run(deliveryId, index, answer, user, now);
  }

  clear(deliveryId: number): void {
    this.database.prepare('DELETE FROM notification_answers WHERE delivery_id = ?').run(deliveryId);
  }
}
