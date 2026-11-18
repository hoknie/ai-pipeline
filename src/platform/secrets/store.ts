/**
 * The store of secret values by an opaque key. Deleting a missing key succeeds; every failure is an
 * `AppError` with a fixed text.
 */
export interface SecretStore {
  /** Throws when the backend cannot be used right now. */
  check(): Promise<void>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type SecretBackendName = 'keyring' | 'file';
