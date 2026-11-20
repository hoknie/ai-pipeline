import type { Database } from '../../../platform/sqlite/index.ts';
import type { NotificationEventKind, Subscription } from '../types/index.ts';

interface Row {
  id: string;
  connection_id: string;
  project_path: string | null;
  events_json: string;
  enabled: number;
  failure_streak: number;
  disabled_reason: string | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  'id, connection_id, project_path, events_json, enabled, failure_streak, disabled_reason, created_at, updated_at';

function toSubscription(row: Row): Subscription {
  return {
    id: row.id,
    connectionId: row.connection_id,
    projectPath: row.project_path,
    events: JSON.parse(row.events_json) as NotificationEventKind[],
    enabled: row.enabled === 1,
    failureStreak: row.failure_streak,
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The table `notification_subscriptions`; every method is one statement. */
export class SubscriptionRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  all(): Subscription[] {
    const rows = this.database
      .prepare(`SELECT ${COLUMNS} FROM notification_subscriptions ORDER BY created_at, rowid`)
      .all() as unknown as Row[];
    return rows.map(toSubscription);
  }

  find(id: string): Subscription | undefined {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM notification_subscriptions WHERE id = ?`)
      .get(id) as Row | undefined;
    return row === undefined ? undefined : toSubscription(row);
  }

  ofConnection(connectionId: string): Subscription[] {
    return this.all().filter((one) => one.connectionId === connectionId);
  }

  insert(subscription: Subscription): void {
    this.database
      .prepare(
        `INSERT INTO notification_subscriptions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        subscription.id,
        subscription.connectionId,
        subscription.projectPath,
        JSON.stringify(subscription.events),
        subscription.enabled ? 1 : 0,
        subscription.failureStreak,
        subscription.disabledReason,
        subscription.createdAt,
        subscription.updatedAt,
      );
  }

  setEvents(id: string, events: readonly NotificationEventKind[], now: number): void {
    this.database
      .prepare('UPDATE notification_subscriptions SET events_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(events), now, id);
  }

  setEnabled(id: string, enabled: boolean, now: number): void {
    this.database
      .prepare('UPDATE notification_subscriptions SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id);
  }

  /** Counts one more failed delivery in a row; returns the count. */
  addFailure(id: string): number {
    const row = this.database
      .prepare(
        'UPDATE notification_subscriptions SET failure_streak = failure_streak + 1 WHERE id = ? RETURNING failure_streak',
      )
      .get(id) as { failure_streak: number } | undefined;
    return row?.failure_streak ?? 0;
  }

  /** Sets the failures in a row and why the subscription switched its connection off. */
  setFailures(id: string, streak: number, reason: string | null): void {
    this.database
      .prepare(
        'UPDATE notification_subscriptions SET failure_streak = ?, disabled_reason = ? WHERE id = ?',
      )
      .run(streak, reason, id);
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM notification_subscriptions WHERE id = ?').run(id);
  }

  deleteOfConnection(connectionId: string): void {
    this.database
      .prepare('DELETE FROM notification_subscriptions WHERE connection_id = ?')
      .run(connectionId);
  }

  /** One statement: part of the transaction that moves a project. */
  moveProject(from: string, to: string): void {
    this.database
      .prepare('UPDATE notification_subscriptions SET project_path = ? WHERE project_path = ?')
      .run(to, from);
  }

  /** One statement: part of the transaction that forgets a project. */
  deleteOfProject(path: string): void {
    this.database
      .prepare('DELETE FROM notification_subscriptions WHERE project_path = ?')
      .run(path);
  }
}
