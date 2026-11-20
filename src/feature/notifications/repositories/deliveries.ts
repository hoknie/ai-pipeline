import { randomBytes } from 'node:crypto';

import type { Database } from '../../../platform/sqlite/index.ts';
import type {
  Delivery,
  DeliveryKind,
  DeliveryState,
  EventData,
  ExternalRef,
} from '../types/index.ts';

interface Row {
  id: number;
  short_key: string;
  subscription_id: string;
  event_key: string;
  kind: string;
  run_id: string;
  group_slug: string | null;
  question_key: string | null;
  payload_json: string;
  state: string;
  attempts: number;
  next_attempt_at: number;
  last_attempt_at: number | null;
  last_error: string | null;
  external_ref_json: string | null;
  closed_by: string | null;
  created_at: number;
  updated_at: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Ten characters of base32: short enough for the button data of a channel and not guessable. */
export function newShortKey(): string {
  return [...randomBytes(10)].map((byte) => ALPHABET[byte % 32]).join('');
}

function toDelivery(row: Row): Delivery {
  return {
    id: row.id,
    shortKey: row.short_key,
    subscriptionId: row.subscription_id,
    eventKey: row.event_key,
    kind: row.kind as DeliveryKind,
    run: row.run_id,
    group: row.group_slug,
    questionKey: row.question_key,
    payload: JSON.parse(row.payload_json) as EventData,
    state: row.state as DeliveryState,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    external:
      row.external_ref_json === null ? null : (JSON.parse(row.external_ref_json) as ExternalRef),
    closedBy: row.closed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewDelivery {
  subscriptionId: string;
  eventKey: string;
  kind: DeliveryKind;
  run: string;
  group: string | null;
  /** The key of the open question; null for the events that are not questions. */
  questionKey: string | null;
  payload: EventData;
  /** A delivery born closed (`before_subscription`) is never sent. */
  closedBy?: string;
}

export interface JournalFilter {
  subscription?: string | undefined;
  state?: DeliveryState | undefined;
  limit: number;
}

/**
 * The table `notification_deliveries`: the outgoing queue and the journal at once. Every method
 * is one statement; the claim is atomic, so one event reaches one subscription once.
 */
export class DeliveryRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Records the event for the subscription; null when it is recorded already. */
  claim(input: NewDelivery, now: number): Delivery | null {
    const closed = input.closedBy !== undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shortKey = newShortKey();
      try {
        const result = this.database
          .prepare(
            `INSERT INTO notification_deliveries
             (short_key, subscription_id, event_key, kind, run_id, group_slug, question_key, payload_json,
              state, attempts, next_attempt_at, closed_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT (subscription_id, event_key) DO NOTHING`,
          )
          .run(
            shortKey,
            input.subscriptionId,
            input.eventKey,
            input.kind,
            input.run,
            input.group,
            input.questionKey,
            JSON.stringify(input.payload),
            closed ? 'closed' : 'pending',
            now,
            input.closedBy ?? null,
            now,
            now,
          );
        if (result.changes === 0) return null;
        return this.find(Number(result.lastInsertRowid)) ?? null;
      } catch (error) {
        if (!String(error).includes('short_key')) throw error;
      }
    }
    throw new Error('cannot make a short key');
  }

  find(id: number): Delivery | undefined {
    return this.one('SELECT * FROM notification_deliveries WHERE id = ?', id);
  }

  findByShortKey(shortKey: string): Delivery | undefined {
    return this.one('SELECT * FROM notification_deliveries WHERE short_key = ?', shortKey);
  }

  /** The delivery whose message sits in the chat at `message`; the reference names it `message_id`. */
  findByMessage(connectionId: string, message: string): Delivery | undefined {
    return this.one(
      `SELECT d.* FROM notification_deliveries d
       JOIN notification_subscriptions s ON s.id = d.subscription_id
       WHERE s.connection_id = ? AND d.state IN ('sent', 'closed')
         AND CAST(json_extract(d.external_ref_json, '$.message_id') AS TEXT) = ?
       ORDER BY d.id DESC LIMIT 1`,
      connectionId,
      message,
    );
  }

  /** Pending deliveries whose time has come, oldest first. */
  due(now: number, limit: number): Delivery[] {
    return this.many(
      "SELECT * FROM notification_deliveries WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT ?",
      now,
      limit,
    );
  }

  /** The time of the earliest pending delivery; null when none waits. */
  nextAttemptAt(): number | null {
    const row = this.database
      .prepare(
        "SELECT MIN(next_attempt_at) AS at FROM notification_deliveries WHERE state = 'pending'",
      )
      .get() as { at: number | null };
    return row.at;
  }

  /** Deliveries of a run in the states given. */
  ofRun(run: string, states: readonly DeliveryState[]): Delivery[] {
    return this.many(
      `SELECT * FROM notification_deliveries WHERE run_id = ? AND state IN (${states.map(() => '?').join(',')}) ORDER BY id`,
      run,
      ...states,
    );
  }

  /** Deliveries of one event of a run (all its subscriptions). */
  ofEvent(eventKey: string): Delivery[] {
    return this.many(
      'SELECT * FROM notification_deliveries WHERE event_key = ? ORDER BY id',
      eventKey,
    );
  }

  journal(filter: JournalFilter): Delivery[] {
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (filter.subscription !== undefined) {
      where.push('subscription_id = ?');
      values.push(filter.subscription);
    }
    if (filter.state !== undefined) {
      where.push('state = ?');
      values.push(filter.state);
    }
    return this.many(
      `SELECT * FROM notification_deliveries ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY id DESC LIMIT ?`,
      ...values,
      filter.limit,
    );
  }

  private one(sql: string, ...values: (string | number)[]): Delivery | undefined {
    const row = this.database.prepare(sql).get(...values) as Row | undefined;
    return row === undefined ? undefined : toDelivery(row);
  }

  private many(sql: string, ...values: (string | number)[]): Delivery[] {
    return (this.database.prepare(sql).all(...values) as unknown as Row[]).map(toDelivery);
  }
}
