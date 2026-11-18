import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { spawnRunner, type CommandRunner } from './command.ts';
import { secretFailure } from './errors.ts';
import { EncryptedFileStore } from './file.ts';
import { KeychainStore, SecretServiceStore } from './keyring.ts';
import type { SecretBackendName, SecretStore } from './store.ts';

export interface SecretStoreOptions {
  stateDirectory: string;
  environment: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Runs `security` / `secret-tool`; the system runner by default. */
  run?: CommandRunner;
}

const directoryOf = (stateDirectory: string): string => join(stateDirectory, 'secrets');

/** Refuses every use: the selected backend is not there, and nothing else takes its place. */
class UnavailableStore implements SecretStore {
  private readonly failure: Parameters<typeof secretFailure>[0];

  constructor(failure: Parameters<typeof secretFailure>[0]) {
    this.failure = failure;
  }

  check(): Promise<void> {
    return Promise.reject(secretFailure(this.failure));
  }

  get(): Promise<string | null> {
    return this.check().then(() => null);
  }

  put(): Promise<void> {
    return this.check();
  }

  delete(): Promise<void> {
    return this.check();
  }
}

/** Pins the backend on the first write: an installation never switches silently to another. */
class PinnedStore implements SecretStore {
  private readonly inner: SecretStore;
  private readonly pin: () => void;

  constructor(inner: SecretStore, pin: () => void) {
    this.inner = inner;
    this.pin = pin;
  }

  check(): Promise<void> {
    return this.inner.check();
  }

  get(key: string): Promise<string | null> {
    return this.inner.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    await this.inner.check();
    this.pin();
    await this.inner.put(key, value);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
}

function requestedBackend(options: SecretStoreOptions): SecretBackendName | null {
  const named = options.environment.AIP_SECRETS_BACKEND;
  if (named === 'file' || named === 'keyring') return named;
  if (named !== undefined && named !== '') return null;
  const platform = options.platform ?? process.platform;
  return platform === 'darwin' || platform === 'linux' ? 'keyring' : null;
}

function pinnedBackend(directory: string): SecretBackendName | null {
  const path = join(directory, 'backend.json');
  if (!existsSync(path)) return null;
  try {
    const value = (JSON.parse(readFileSync(path, 'utf8')) as { backend?: unknown }).backend;
    return value === 'file' || value === 'keyring' ? value : null;
  } catch {
    return null;
  }
}

function pinBackend(directory: string, backend: SecretBackendName): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (pinnedBackend(directory) !== null) return;
  const temporary = join(directory, `backend.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(temporary, JSON.stringify({ backend }), { mode: 0o600 });
  renameSync(temporary, join(directory, 'backend.json'));
}

function build(backend: SecretBackendName, options: SecretStoreOptions): SecretStore {
  const directory = directoryOf(options.stateDirectory);
  if (backend === 'file') {
    const fd = options.environment.AIP_SECRETS_KEY_FD;
    const keyFd = fd !== undefined && /^\d+$/.test(fd) ? Number(fd) : undefined;
    return new EncryptedFileStore(directory, {
      keyFile: options.environment.AIP_SECRETS_KEY_FILE,
      keyFd,
    });
  }
  const run = options.run ?? spawnRunner();
  return (options.platform ?? process.platform) === 'darwin'
    ? new KeychainStore(run)
    : new SecretServiceStore(run);
}

/**
 * The secret store a daemon uses. The backend comes from the explicit setting
 * `AIP_SECRETS_BACKEND` (`keyring`, the default on macOS and Linux, or `file`), never from a
 * fallback after a failure, and it is pinned in the state directory on the first write: another
 * setting afterwards makes the store refuse until the pinned backend is selected again.
 */
export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const requested = requestedBackend(options);
  if (requested === null) return new UnavailableStore('no_backend');
  const directory = directoryOf(options.stateDirectory);
  const pinned = pinnedBackend(directory);
  if (pinned !== null && pinned !== requested) return new UnavailableStore('backend_mismatch');
  return new PinnedStore(build(requested, options), () => pinBackend(directory, requested));
}

/** The id of this installation inside the keys of the secret store; created once. */
export function installationId(stateDirectory: string): string {
  const directory = directoryOf(stateDirectory);
  const path = join(directory, 'installation');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = randomBytes(8).toString('hex');
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, id, { mode: 0o600 });
  renameSync(temporary, path);
  return id;
}
