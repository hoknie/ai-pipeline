import { unavailable, type AppError } from '../errors/index.ts';

/** Fixed texts: an error of the secret storage never carries a value, a key, a path or output of a tool. */
const TEXTS = {
  no_backend: 'no secret storage backend is available on this system',
  command_failed: 'the system secret storage did not answer',
  key_missing: 'the encryption key of the secret file was not provided',
  key_invalid: 'the encryption key does not open the secret file',
  key_unsafe: 'the encryption key file is not private to its owner',
  store_unsafe: 'the secret file or its directory is not private to its owner',
  store_corrupt: 'the secret file is damaged',
  backend_mismatch: 'the secret storage backend differs from the one this installation uses',
} as const;

export type SecretStoreFailure = keyof typeof TEXTS;

export function secretFailure(code: SecretStoreFailure): AppError {
  return unavailable(`secrets.${code}`, TEXTS[code]);
}
