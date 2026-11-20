import type { Database } from '../../../platform/sqlite/index.ts';
import type { ExternalRef } from '../types/index.ts';

/**
 * The table `notification_deliveries`, the writes that follow an attempt: sent, retried, failed,
 * closed, cleared. Every method is one statement.
 */
export class DeliveryOutcomes {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  markSent(id: number, external: ExternalRef, attempts: number, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'sent', attempts = ?, external_ref_json = ?,
         last_error = NULL, last_attempt_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(attempts, JSON.stringify(external), now, now, id);
  }

  markRetry(id: number, attempts: number, nextAttemptAt: number, error: string, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ?,
         last_attempt_at = ?, updated_at = ? WHERE id = ? AND state = 'pending'`,
      )
      .run(attempts, nextAttemptAt, error, now, now, id);
  }

  markFailed(id: number, attempts: number, error: string, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'failed', attempts = ?, last_error = ?,
         last_attempt_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(attempts, error, now, now, id);
  }

  markClosed(id: number, closedBy: string, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'closed', closed_by = COALESCE(closed_by, ?), updated_at = ? WHERE id = ?`,
      )
      .run(closedBy, now, id);
  }

  /** Deliveries of a subscription that wait for their turn stop waiting: they have failed. */
  failPendingOfConnection(connectionId: string, error: string, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'failed', last_error = ?, updated_at = ?
         WHERE state = 'pending' AND subscription_id IN
           (SELECT id FROM notification_subscriptions WHERE connection_id = ?)`,
      )
      .run(error, now, connectionId);
  }

  /** A delivery that was sent or failed goes out again; a test call is never repeated. */
  reopen(id: number, now: number): boolean {
    const result = this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'pending', attempts = 0, next_attempt_at = ?,
         last_error = NULL, updated_at = ?
         WHERE id = ? AND state IN ('sent', 'failed') AND kind <> 'test'`,
      )
      .run(now, now, id);
    return Number(result.changes) > 0;
  }

  /** A test call that a restart interrupted will not be sent: it has failed. */
  failInterruptedTests(now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'failed', last_error = 'interrupted', updated_at = ?
         WHERE state = 'pending' AND kind = 'test'`,
      )
      .run(now);
  }

  /** Records who answers before the answer is applied; the state changes when the question closes. */
  setClosedBy(id: number, closedBy: string, now: number): void {
    this.database
      .prepare('UPDATE notification_deliveries SET closed_by = ?, updated_at = ? WHERE id = ?')
      .run(closedBy, now, id);
  }

  /** Pending deliveries of the subscriptions of a connection stop waiting. */
  closePendingOfConnection(connectionId: string, closedBy: string, now: number): void {
    this.database
      .prepare(
        `UPDATE notification_deliveries SET state = 'closed', closed_by = ?, updated_at = ?
         WHERE state = 'pending' AND subscription_id IN
           (SELECT id FROM notification_subscriptions WHERE connection_id = ?)`,
      )
      .run(closedBy, now, connectionId);
  }

  /** Deletes the finished deliveries older than `before`, except the messages of an open question. */
  prune(before: number): number {
    const result = this.database
      .prepare(
        `DELETE FROM notification_deliveries WHERE updated_at < ?
         AND state IN ('failed', 'closed', 'sent') AND NOT (kind = 'question' AND state = 'sent')`,
      )
      .run(before);
    return Number(result.changes);
  }
}
