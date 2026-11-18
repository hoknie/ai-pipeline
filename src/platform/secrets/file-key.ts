import { lstatSync, readFileSync } from 'node:fs';

import { secretFailure } from './errors.ts';

/** Where the external key of the encrypted file comes from: a file or an inherited descriptor. */
export interface KeySource {
  keyFile?: string | undefined;
  keyFd?: number | undefined;
}

/** A path private to its owner: not a link, owned by this user, without any access for others. */
export function assertPrivate(
  path: string,
  kind: 'file' | 'directory',
  failure: 'key_unsafe' | 'store_unsafe',
): void {
  const stat = lstatSync(path);
  const typeOk = kind === 'file' ? stat.isFile() : stat.isDirectory();
  const owned = typeof process.getuid !== 'function' || stat.uid === process.getuid();
  if (stat.isSymbolicLink() || !typeOk || !owned || (stat.mode & 0o077) !== 0) {
    throw secretFailure(failure);
  }
}

/** Reads 32 bytes from hex or base64 text; anything else is refused without echoing it. */
export function parseKey(text: string): Buffer {
  const trimmed = text.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : /^[A-Za-z0-9+/]{43}=?$/.test(trimmed)
      ? Buffer.from(trimmed, 'base64')
      : null;
  if (bytes === null || bytes.length !== 32) throw secretFailure('key_invalid');
  return bytes;
}

/**
 * The key of the supervisor: read once and kept in memory only. A key file must be private to its
 * owner; without any source the store has no key and refuses to work.
 */
export function readKey(source: KeySource): Buffer {
  try {
    if (source.keyFd !== undefined) return parseKey(readFileSync(source.keyFd, 'utf8'));
    if (source.keyFile === undefined) throw secretFailure('key_missing');
    assertPrivate(source.keyFile, 'file', 'key_unsafe');
    return parseKey(readFileSync(source.keyFile, 'utf8'));
  } catch (error) {
    if ((error as { code?: unknown }).code?.toString().startsWith('secrets.')) throw error;
    throw secretFailure('key_missing');
  }
}
