export type SecretOperationKind = 'write' | 'delete';
/**
 * `pending_write`: the new key may exist but is not active; `pending_cleanup`: the old key is
 * left to delete; `pending_delete`: the active key goes.
 */
export type SecretPhase = 'pending_write' | 'pending_cleanup' | 'pending_delete';

/** The active generation of a secret of a connection (an opaque id, never the value). */
export interface SecretSlot {
  connectionId: string;
  slot: string;
  generation: string;
  version: number;
  updatedAt: number;
}

/** The durable intent of a change of a secret: written before the store is touched. */
export interface SecretOperation {
  id: number;
  connectionId: string;
  slot: string;
  kind: SecretOperationKind;
  phase: SecretPhase;
  previousGeneration: string | null;
  nextGeneration: string | null;
  createdAt: number;
}

/**
 * The key of a generation in the secret store: built from ids that never change, so a renamed
 * connection or a moved project keeps its secret, and a replaced value never reuses a key.
 */
export function secretKey(
  installation: string,
  connectionId: string,
  slot: string,
  generation: string,
): string {
  return `aip/${installation}/${connectionId}/${slot}/${generation}`;
}
