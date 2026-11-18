import type { Database } from '../../../platform/sqlite/index.ts';
import type {
  SecretOperation,
  SecretOperationKind,
  SecretPhase,
  SecretSlot,
} from '../types/index.ts';

interface SlotRow {
  connection_id: string;
  slot: string;
  generation: string;
  version: number;
  updated_at: number;
}

interface OperationRow {
  id: number;
  connection_id: string;
  slot: string;
  kind: string;
  phase: string;
  previous_generation: string | null;
  next_generation: string | null;
  created_at: number;
}

const toSlot = (row: SlotRow): SecretSlot => ({
  connectionId: row.connection_id,
  slot: row.slot,
  generation: row.generation,
  version: row.version,
  updatedAt: row.updated_at,
});

const toOperation = (row: OperationRow): SecretOperation => ({
  id: row.id,
  connectionId: row.connection_id,
  slot: row.slot,
  kind: row.kind as SecretOperationKind,
  phase: row.phase as SecretPhase,
  previousGeneration: row.previous_generation,
  nextGeneration: row.next_generation,
  createdAt: row.created_at,
});

export interface NewOperation {
  connectionId: string;
  slot: string;
  kind: SecretOperationKind;
  phase: SecretPhase;
  previousGeneration: string | null;
  nextGeneration: string | null;
  createdAt: number;
}

/**
 * The tables `integration_secret_slots` and `integration_secret_operations`: opaque generation
 * ids and the intents of changes, never values. One statement per method; transactions are the caller's.
 */
export class SecretRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  slots(connectionId: string): SecretSlot[] {
    const rows = this.database
      .prepare('SELECT * FROM integration_secret_slots WHERE connection_id = ? ORDER BY slot')
      .all(connectionId) as unknown as SlotRow[];
    return rows.map(toSlot);
  }

  slot(connectionId: string, slot: string): SecretSlot | undefined {
    const row = this.database
      .prepare('SELECT * FROM integration_secret_slots WHERE connection_id = ? AND slot = ?')
      .get(connectionId, slot) as SlotRow | undefined;
    return row === undefined ? undefined : toSlot(row);
  }

  /**
   * Compare and swap of the active generation: `expected` is the generation the caller saw (null
   * when there was none). False when someone else switched it first.
   */
  switchGeneration(
    connectionId: string,
    slot: string,
    expected: string | null,
    next: string,
    now: number,
  ): boolean {
    if (expected === null) {
      const result = this.database
        .prepare(
          `INSERT INTO integration_secret_slots (connection_id, slot, generation, version, updated_at)
           VALUES (?, ?, ?, 1, ?) ON CONFLICT (connection_id, slot) DO NOTHING`,
        )
        .run(connectionId, slot, next, now);
      return result.changes === 1;
    }
    const result = this.database
      .prepare(
        `UPDATE integration_secret_slots SET generation = ?, version = version + 1, updated_at = ?
         WHERE connection_id = ? AND slot = ? AND generation = ?`,
      )
      .run(next, now, connectionId, slot, expected);
    return result.changes === 1;
  }

  /** Clears the pointer of a slot when it still names `generation`. */
  clearGeneration(connectionId: string, slot: string, generation: string): boolean {
    const result = this.database
      .prepare(
        'DELETE FROM integration_secret_slots WHERE connection_id = ? AND slot = ? AND generation = ?',
      )
      .run(connectionId, slot, generation);
    return result.changes === 1;
  }

  operations(connectionId?: string): SecretOperation[] {
    const rows = (connectionId === undefined
      ? this.database.prepare('SELECT * FROM integration_secret_operations ORDER BY id').all()
      : this.database
          .prepare(
            'SELECT * FROM integration_secret_operations WHERE connection_id = ? ORDER BY id',
          )
          .all(connectionId)) as unknown as OperationRow[];
    return rows.map(toOperation);
  }

  operationOf(connectionId: string, slot: string): SecretOperation | undefined {
    const row = this.database
      .prepare('SELECT * FROM integration_secret_operations WHERE connection_id = ? AND slot = ?')
      .get(connectionId, slot) as OperationRow | undefined;
    return row === undefined ? undefined : toOperation(row);
  }

  /** Throws when the slot already has an unfinished operation. */
  insertOperation(operation: NewOperation): void {
    this.database
      .prepare(
        `INSERT INTO integration_secret_operations
         (connection_id, slot, kind, phase, previous_generation, next_generation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operation.connectionId,
        operation.slot,
        operation.kind,
        operation.phase,
        operation.previousGeneration,
        operation.nextGeneration,
        operation.createdAt,
      );
  }

  setPhase(id: number, phase: SecretPhase): void {
    this.database
      .prepare('UPDATE integration_secret_operations SET phase = ? WHERE id = ?')
      .run(phase, id);
  }

  deleteOperation(id: number): void {
    this.database.prepare('DELETE FROM integration_secret_operations WHERE id = ?').run(id);
  }

  /** The ids of the connections with an unfinished operation. */
  connectionsWithOperations(): string[] {
    const rows = this.database
      .prepare('SELECT DISTINCT connection_id FROM integration_secret_operations')
      .all() as { connection_id: string }[];
    return rows.map((row) => row.connection_id);
  }
}
