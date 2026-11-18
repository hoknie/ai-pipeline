import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { secretFailure } from './errors.ts';
import { assertPrivate, readKey, type KeySource } from './file-key.ts';
import type { SecretStore } from './store.ts';

interface Sealed {
  n: string;
  t: string;
  c: string;
}

interface Document {
  v: 1;
  check: Sealed;
  entries: Record<string, Sealed>;
}

const CHECK_LABEL = 'aip-secret-file:check';
const aad = (key: string): Buffer => Buffer.from(`aip-secret-file:v1:${key}`, 'utf8');

function seal(key: Buffer, label: Buffer, plain: string): Sealed {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(label);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    n: nonce.toString('base64'),
    t: cipher.getAuthTag().toString('base64'),
    c: body.toString('base64'),
  };
}

function open(key: Buffer, label: Buffer, sealed: Sealed): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.n, 'base64'));
    decipher.setAAD(label);
    decipher.setAuthTag(Buffer.from(sealed.t, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.c, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Secrets in one encrypted file for hosts without a keyring. Every value is sealed with AES-256-GCM
 * under a key the supervisor provides on each start (never kept beside the file), with a fresh
 * nonce per write and the entry key as associated data. Writes replace the file atomically; a
 * missing or wrong key means the store refuses to work: there is no plaintext fallback.
 */
export class EncryptedFileStore implements SecretStore {
  private readonly directory: string;
  private readonly source: KeySource;
  private key: Buffer | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(directory: string, source: KeySource) {
    this.directory = directory;
    this.source = source;
  }

  async check(): Promise<void> {
    await this.exclusive(() => {
      this.load();
    });
  }

  get(key: string): Promise<string | null> {
    return this.exclusive(() => {
      const document = this.load();
      const sealed = document.entries[key];
      if (sealed === undefined) return null;
      const plain = open(this.keyBytes(), aad(key), sealed);
      if (plain === null) throw secretFailure('store_corrupt');
      return plain;
    });
  }

  put(key: string, value: string): Promise<void> {
    return this.exclusive(() => {
      const document = this.load();
      document.entries[key] = seal(this.keyBytes(), aad(key), value);
      this.write(document);
    });
  }

  delete(key: string): Promise<void> {
    return this.exclusive(() => {
      const document = this.load();
      if (!(key in document.entries)) return;
      delete document.entries[key];
      this.write(document);
    });
  }

  private keyBytes(): Buffer {
    if (this.key === null) {
      this.refuseKeyBesideStore();
      this.key = readKey(this.source);
    }
    return this.key;
  }

  /** The key must not live in the directory of the ciphertext. */
  private refuseKeyBesideStore(): void {
    const keyFile = this.source.keyFile;
    if (this.source.keyFd !== undefined || keyFile === undefined) return;
    const real = (path: string): string => {
      try {
        return realpathSync(path);
      } catch {
        return resolve(path);
      }
    };
    const inside = relative(real(this.directory), real(keyFile));
    if (inside !== '' && inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside)) {
      throw secretFailure('key_unsafe');
    }
  }

  private get path(): string {
    return join(this.directory, 'store.enc.json');
  }

  /** Checks the directory and the file, opens the document and the key; a new store is empty. */
  private load(): Document {
    const key = this.keyBytes();
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    assertPrivate(this.directory, 'directory', 'store_unsafe');
    if (!existsSync(this.path))
      return { v: 1, check: seal(key, Buffer.from(CHECK_LABEL), 'ok'), entries: {} };
    assertPrivate(this.path, 'file', 'store_unsafe');
    let document: Document;
    try {
      document = JSON.parse(readFileSync(this.path, 'utf8')) as Document;
      if (document.v !== 1 || typeof document.entries !== 'object') throw new Error('shape');
    } catch {
      throw secretFailure('store_corrupt');
    }
    if (open(key, Buffer.from(CHECK_LABEL), document.check) !== 'ok') {
      throw secretFailure('key_invalid');
    }
    return document;
  }

  /** Writes a sibling file with 0600 and renames it over the store: a crash leaves the old file. */
  private write(document: Document): void {
    const temporary = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(descriptor, JSON.stringify(document));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.path);
    const directory = openSync(this.directory, 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  private exclusive<T>(work: () => T): Promise<T> {
    const run = this.tail.then(() => work());
    this.tail = run.catch(() => undefined);
    return run;
  }
}
