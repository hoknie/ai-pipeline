import { randomBytes } from 'node:crypto';

import type { Database } from '../../../platform/sqlite/index.ts';
import type { SecretStorePort } from '../ports/index.ts';
import type {
  ConnectionRepository,
  DeliveryRepository,
  SecretRepository,
} from '../repositories/index.ts';
import {
  failureCode,
  refusal,
  secretKey,
  validateSecretValue,
  type Connection,
  type SecretOperation,
} from '../types/index.ts';

/** The points of a secret operation after which a test may stop it, as a crash would. */
export type SecretStep = 'intent' | 'written' | 'switched' | 'erased';

export interface SecretDependencies {
  database: Database;
  connections: ConnectionRepository;
  secrets: SecretRepository;
  deliveries: DeliveryRepository;
  store: SecretStorePort;
  /** Identifies this installation inside the keys of the store. */
  installation: () => string;
  now: () => number;
  /** Makes an unguessable, never reused generation id; random by default. */
  newGeneration?: () => string;
  /** Called after every step of an operation; the tests throw from it to cut the operation short. */
  step?: (step: SecretStep) => void;
}

/** The fixed code of a failure of the platform store (never a value, a key or a path), if it is one. */
function detailOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('secrets.') ? code.slice(8) : undefined;
}

/**
 * Secrets of connections. The values live in the secret store; SQLite holds only the active
 * generation of each slot and the durable intent of an operation in flight. An operation writes its
 * intent first, touches only a key of a generation the intent names, switches the active generation
 * in one transaction and then deletes the other generation. A restart finishes it.
 */
export class SecretService {
  private readonly dependencies: SecretDependencies;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(dependencies: SecretDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the slot has an active secret. */
  has(connectionId: string, slot: string): boolean {
    return this.dependencies.secrets.slot(connectionId, slot) !== undefined;
  }

  /** An operation or a cleanup of the connection is not finished: it must do no work. */
  pending(connection: Connection): boolean {
    return (
      connection.state !== 'ready' || this.dependencies.secrets.operations(connection.id).length > 0
    );
  }

  /** Runs `work` in the queue of the connection, after every secret operation queued before it. */
  serialized<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    return this.exclusive(connectionId, work);
  }

  /** Throws when the selected backend cannot be used right now. */
  async check(): Promise<void> {
    try {
      await this.dependencies.store.check();
    } catch (error) {
      throw refusal('backend_unavailable', detailOf(error));
    }
  }

  /** The value of an active secret of a connection with nothing pending. */
  async read(connectionId: string, slot: string): Promise<string> {
    const { secrets, store, installation } = this.dependencies;
    const active = secrets.slot(connectionId, slot);
    if (active === undefined || secrets.operationOf(connectionId, slot) !== undefined) {
      throw refusal('missing_secret', slot);
    }
    let value: string | null;
    try {
      value = await store.get(secretKey(installation(), connectionId, slot, active.generation));
    } catch (error) {
      throw refusal('backend_unavailable', detailOf(error));
    }
    if (value === null) throw refusal('missing_secret', slot);
    return value;
  }

  /** Sets or replaces a secret; the old value stays active until the new one is stored. */
  set(connectionId: string, slot: string, value: string): Promise<void> {
    validateSecretValue(value);
    return this.exclusive(connectionId, async () => {
      const { database, secrets, now, step, store, installation } = this.dependencies;
      this.requireReady(connectionId);
      await this.settle(connectionId, slot);
      await this.check();
      const previous = secrets.slot(connectionId, slot)?.generation ?? null;
      const next = this.generation();
      database.transaction(() =>
        secrets.insertOperation({
          connectionId,
          slot,
          kind: 'write',
          phase: 'pending_write',
          previousGeneration: previous,
          nextGeneration: next,
          createdAt: now(),
        }),
      );
      step?.('intent');
      try {
        await store.put(secretKey(installation(), connectionId, slot, next), value);
      } catch (error) {
        await this.settle(connectionId, slot).catch(() => undefined);
        throw refusal('backend_failed', detailOf(error));
      }
      step?.('written');
      const operation = secrets.operationOf(connectionId, slot)!;
      const switched = database.transaction(() => {
        if (!secrets.switchGeneration(connectionId, slot, previous, next, now())) return false;
        if (previous === null) secrets.deleteOperation(operation.id);
        else secrets.setPhase(operation.id, 'pending_cleanup');
        return true;
      });
      if (!switched) {
        await this.settle(connectionId, slot).catch(() => undefined);
        throw refusal('operation_pending');
      }
      step?.('switched');
      await this.settle(connectionId, slot);
    });
  }

  /** Removes a secret: the connection is switched off before the store is touched. */
  remove(connectionId: string, slot: string): Promise<void> {
    return this.exclusive(connectionId, async () => {
      const { database, connections, secrets, now, step } = this.dependencies;
      this.requireReady(connectionId);
      await this.settle(connectionId, slot);
      const active = secrets.slot(connectionId, slot);
      if (active === undefined) throw refusal('no_secret');
      database.transaction(() => {
        connections.setEnabled(connectionId, false, now());
        secrets.insertOperation({
          connectionId,
          slot,
          kind: 'delete',
          phase: 'pending_delete',
          previousGeneration: active.generation,
          nextGeneration: null,
          createdAt: now(),
        });
      });
      step?.('intent');
      await this.settle(connectionId, slot);
    });
  }

  /**
   * Removes a connection: a tombstone first, so it has no authority while its secrets are deleted by
   * the generations the registry names; the rows go only after the store confirmed every deletion.
   */
  removeConnection(connectionId: string): Promise<void> {
    return this.exclusive(connectionId, async () => {
      const { database, connections, secrets, now, step } = this.dependencies;
      if (connections.find(connectionId) === undefined) throw refusal('not_found');
      database.transaction(() => {
        connections.tombstone(connectionId, now());
        for (const slot of secrets.slots(connectionId)) {
          if (secrets.operationOf(connectionId, slot.slot) !== undefined) continue;
          secrets.insertOperation({
            connectionId,
            slot: slot.slot,
            kind: 'delete',
            phase: 'pending_delete',
            previousGeneration: slot.generation,
            nextGeneration: null,
            createdAt: now(),
          });
        }
      });
      step?.('intent');
      try {
        await this.drain(connectionId);
      } catch (error) {
        if (failureCode(error) === 'backend_failed') throw refusal('cleanup_pending');
        throw error;
      }
    });
  }

  /**
   * Finishes every operation and cleanup a stop left behind. A backend that is not available keeps
   * the intents; the connections stay without authority. Safe to repeat.
   */
  async recover(): Promise<{ failed: number }> {
    const { connections, secrets } = this.dependencies;
    const ids = new Set(secrets.connectionsWithOperations());
    for (const connection of connections.all())
      if (connection.state !== 'ready') ids.add(connection.id);
    let failed = 0;
    for (const id of ids) {
      try {
        await this.exclusive(id, () => this.drain(id));
      } catch (error) {
        if (failureCode(error) === null) throw error;
        failed += 1;
      }
    }
    return { failed };
  }

  private requireReady(connectionId: string): Connection {
    const connection = this.dependencies.connections.find(connectionId);
    if (connection === undefined) throw refusal('not_found');
    if (connection.state !== 'ready') throw refusal('cleanup_pending');
    return connection;
  }

  private generation(): string {
    return (this.dependencies.newGeneration ?? (() => randomBytes(12).toString('hex')))();
  }

  /** Finishes the operation of a slot, if it has one. */
  private async settle(connectionId: string, slot: string): Promise<void> {
    const operation = this.dependencies.secrets.operationOf(connectionId, slot);
    if (operation !== undefined) await this.complete(operation);
  }

  /** Finishes all operations of a connection, then the removal of a tombstoned one. */
  private async drain(connectionId: string): Promise<void> {
    const { database, connections, secrets, deliveries, now } = this.dependencies;
    for (const operation of secrets.operations(connectionId)) await this.complete(operation);
    const connection = connections.find(connectionId);
    if (connection?.state !== 'cleanup_pending') return;
    // A replacement that was cut short leaves its active generation: it goes too.
    for (const slot of secrets.slots(connectionId)) {
      database.transaction(() =>
        secrets.insertOperation({
          connectionId,
          slot: slot.slot,
          kind: 'delete',
          phase: 'pending_delete',
          previousGeneration: slot.generation,
          nextGeneration: null,
          createdAt: now(),
        }),
      );
      await this.settle(connectionId, slot.slot);
    }
    database.transaction(() => {
      deliveries.deleteOf(connectionId);
      connections.delete(connectionId);
    });
  }

  /**
   * One operation to its end, by the generations its intent names: before the switch the new key
   * goes, after it the old one, and a slot being deleted loses the key it pointed at.
   */
  private async complete(operation: SecretOperation): Promise<void> {
    const { database, secrets, step } = this.dependencies;
    const doomed =
      operation.phase === 'pending_write' ? operation.nextGeneration : operation.previousGeneration;
    if (doomed !== null) await this.erase(operation, doomed);
    step?.('erased');
    database.transaction(() => {
      if (operation.phase === 'pending_delete' && operation.previousGeneration !== null) {
        secrets.clearGeneration(
          operation.connectionId,
          operation.slot,
          operation.previousGeneration,
        );
      }
      secrets.deleteOperation(operation.id);
    });
  }

  private async erase(operation: SecretOperation, generation: string): Promise<void> {
    const { store, installation } = this.dependencies;
    try {
      await store.delete(
        secretKey(installation(), operation.connectionId, operation.slot, generation),
      );
    } catch (error) {
      throw refusal('backend_failed', detailOf(error));
    }
  }

  /** One operation at a time per connection. */
  private exclusive<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(connectionId) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.catch(() => undefined);
    this.chains.set(connectionId, tail);
    void tail.then(() => {
      if (this.chains.get(connectionId) === tail) this.chains.delete(connectionId);
    });
    return run;
  }
}
