import type { Database } from '../../../platform/sqlite/index.ts';
import type { Delivery, DeliveryState, OperationResult } from '../types/index.ts';

interface Row {
  connection_id: string;
  external_event_id: string;
  state: string;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

const toDelivery = (row: Row): Delivery => ({
  connectionId: row.connection_id,
  externalEventId: row.external_event_id,
  state: row.state as DeliveryState,
  result: row.result_json === null ? null : (JSON.parse(row.result_json) as OperationResult),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The table `integration_deliveries`: the claims of inbound events, unique per connection and event id. */
export class DeliveryRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Claims the id atomically: true for the first caller, false for every later one. */
  claim(connectionId: string, externalEventId: string, now: number): boolean {
    const result = this.database
      .prepare(
        `INSERT INTO integration_deliveries
         (connection_id, external_event_id, state, result_json, created_at, updated_at)
         VALUES (?, ?, 'processing', NULL, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(connectionId, externalEventId, now, now);
    return result.changes === 1;
  }

  find(connectionId: string, externalEventId: string): Delivery | undefined {
    const row = this.database
      .prepare(
        'SELECT * FROM integration_deliveries WHERE connection_id = ? AND external_event_id = ?',
      )
      .get(connectionId, externalEventId) as Row | undefined;
    return row === undefined ? undefined : toDelivery(row);
  }

  markApplied(
    connectionId: string,
    externalEventId: string,
    result: OperationResult,
    now: number,
  ): void {
    this.database
      .prepare(
        `UPDATE integration_deliveries SET state = 'applied', result_json = ?, updated_at = ?
         WHERE connection_id = ? AND external_event_id = ?`,
      )
      .run(JSON.stringify(result), now, connectionId, externalEventId);
  }

  /** Gives the claim back after a refusal that is known to have changed nothing. */
  release(connectionId: string, externalEventId: string): void {
    this.database
      .prepare(
        `DELETE FROM integration_deliveries
         WHERE connection_id = ? AND external_event_id = ? AND state = 'processing'`,
      )
      .run(connectionId, externalEventId);
  }

  deleteOf(connectionId: string): void {
    this.database
      .prepare('DELETE FROM integration_deliveries WHERE connection_id = ?')
      .run(connectionId);
  }
}
