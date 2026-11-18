/**
 * The store of secret values by an opaque key. Deleting a missing key succeeds; every failure is
 * a refusal with a static text, never a part of a value or of the key.
 */
export interface SecretStorePort {
  /** Throws when the selected backend cannot be used right now. */
  check(): Promise<void>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The secrets of one connection, as an adapter gets them for an allowed operation. */
export interface SecretReader {
  read(slot: string): Promise<string>;
}
