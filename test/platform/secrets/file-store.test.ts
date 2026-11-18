import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EncryptedFileStore } from '../../../src/platform/secrets/index.ts';

const SENTINEL = 'sentinel-secret-5f1c9e';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'aip-secret-file-'));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  const directory = join(root, 'secrets');
  const make = (source: { keyFile?: string; keyFd?: number } = { keyFile }) =>
    new EncryptedFileStore(directory, source);
  return { root, keyFile, directory, make, file: join(directory, 'store.enc.json') };
}

describe('encrypted file backend', () => {
  it('keeps values across a restart and holds no plaintext', async () => {
    const s = sandbox();
    const store = s.make();
    await store.put('aip/i/c1/token/g1', SENTINEL);
    await store.put('aip/i/c1/signing/g1', 'other');
    const raw = readFileSync(s.file, 'utf8');
    expect(raw).not.toContain(SENTINEL);
    expect(raw).not.toContain('other');
    const restarted = s.make();
    expect(await restarted.get('aip/i/c1/token/g1')).toBe(SENTINEL);
    expect(await restarted.get('missing')).toBeNull();
    await restarted.delete('aip/i/c1/token/g1');
    await restarted.delete('aip/i/c1/token/g1');
    expect(await s.make().get('aip/i/c1/token/g1')).toBeNull();
    expect(await s.make().get('aip/i/c1/signing/g1')).toBe('other');
  });

  it('seals every write with a fresh nonce and leaves no temporary file', async () => {
    const s = sandbox();
    const store = s.make();
    await store.put('k', SENTINEL);
    const first = JSON.parse(readFileSync(s.file, 'utf8')).entries.k;
    await store.put('k', SENTINEL);
    const second = JSON.parse(readFileSync(s.file, 'utf8')).entries.k;
    expect(second.n).not.toBe(first.n);
    expect(second.c).not.toBe(first.c);
    expect(readdirSync(s.directory)).toEqual(['store.enc.json']);
  });

  it('works with a key from an inherited descriptor', async () => {
    const s = sandbox();
    const fd = openSync(s.keyFile, 'r');
    try {
      const store = s.make({ keyFd: fd });
      await store.put('k', SENTINEL);
      expect(await store.get('k')).toBe(SENTINEL);
    } finally {
      closeSync(fd);
    }
    expect(await s.make().get('k')).toBe(SENTINEL);
  });

  it('refuses to work without the external key, and writes nothing', async () => {
    const s = sandbox();
    const store = s.make({});
    for (const call of [
      () => store.check(),
      () => store.get('k'),
      () => store.put('k', SENTINEL),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'secrets.key_missing' });
    }
    expect(() => readdirSync(s.directory)).toThrow();
  });

  it('refuses a wrong key without revealing anything', async () => {
    const s = sandbox();
    await s.make().put('k', SENTINEL);
    writeFileSync(s.keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    const error = await s
      .make()
      .get('k')
      .catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: 'secrets.key_invalid' });
    expect(String((error as Error).message)).not.toContain(SENTINEL);
    await expect(s.make().put('k', 'new')).rejects.toMatchObject({ code: 'secrets.key_invalid' });
  });

  it('refuses a key that is not 32 bytes of hex or base64', async () => {
    const s = sandbox();
    writeFileSync(s.keyFile, SENTINEL, { mode: 0o600 });
    const error = await s
      .make()
      .check()
      .catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: 'secrets.key_invalid' });
    expect(String((error as Error).message)).not.toContain(SENTINEL);
    writeFileSync(s.keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
    await s.make().check();
  });

  it('refuses damaged ciphertext and a damaged file', async () => {
    const s = sandbox();
    await s.make().put('k', SENTINEL);
    const document = JSON.parse(readFileSync(s.file, 'utf8'));
    document.entries.k.c = Buffer.from('tampered').toString('base64');
    writeFileSync(s.file, JSON.stringify(document), { mode: 0o600 });
    await expect(s.make().get('k')).rejects.toMatchObject({ code: 'secrets.store_corrupt' });
    // The ciphertext of another entry cannot be moved under this key.
    await s.make().put('a', 'one');
    const moved = JSON.parse(readFileSync(s.file, 'utf8'));
    moved.entries.b = moved.entries.a;
    writeFileSync(s.file, JSON.stringify(moved), { mode: 0o600 });
    await expect(s.make().get('b')).rejects.toMatchObject({ code: 'secrets.store_corrupt' });
    writeFileSync(s.file, '{"v":1,', { mode: 0o600 });
    await expect(s.make().check()).rejects.toMatchObject({ code: 'secrets.store_corrupt' });
  });

  it('refuses a key file kept in the directory of the encrypted file', async () => {
    const s = sandbox();
    mkdirSync(s.directory, { mode: 0o700, recursive: true });
    const beside = join(s.directory, 'key');
    writeFileSync(beside, randomBytes(32).toString('hex'), { mode: 0o600 });
    await expect(s.make({ keyFile: beside }).put('k', 'v')).rejects.toMatchObject({
      code: 'secrets.key_unsafe',
    });
  });

  it('refuses a key file or a store that others can read, or that is a link', async () => {
    const open = sandbox();
    chmodSync(open.keyFile, 0o644);
    await expect(open.make().check()).rejects.toMatchObject({ code: 'secrets.key_unsafe' });

    const linked = sandbox();
    const real = join(linked.root, 'real-key');
    writeFileSync(real, randomBytes(32).toString('hex'), { mode: 0o600 });
    const link = join(linked.root, 'link-key');
    symlinkSync(real, link);
    await expect(linked.make({ keyFile: link }).check()).rejects.toMatchObject({
      code: 'secrets.key_unsafe',
    });

    const loose = sandbox();
    await loose.make().put('k', 'v');
    chmodSync(loose.file, 0o644);
    await expect(loose.make().get('k')).rejects.toMatchObject({ code: 'secrets.store_unsafe' });
    chmodSync(loose.file, 0o600);
    chmodSync(loose.directory, 0o755);
    await expect(loose.make().get('k')).rejects.toMatchObject({ code: 'secrets.store_unsafe' });

    const swapped = sandbox();
    const elsewhere = join(swapped.root, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, swapped.directory);
    await expect(swapped.make().get('k')).rejects.toMatchObject({ code: 'secrets.store_unsafe' });
  });

  it('creates its directory private to the owner', async () => {
    const s = sandbox();
    await s.make().put('k', 'v');
    const { statSync } = await import('node:fs');
    expect(statSync(s.directory).mode & 0o077).toBe(0);
    expect(statSync(s.file).mode & 0o077).toBe(0);
  });

  it('serializes concurrent writes', async () => {
    const s = sandbox();
    const store = s.make();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.put(`k${index}`, `v${index}`)),
    );
    for (let index = 0; index < 10; index += 1) {
      expect(await s.make().get(`k${index}`)).toBe(`v${index}`);
    }
  });
});
