import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FilePatchStorage, storageFor } from '../../src/daemon/patches.ts';

function storage(): FilePatchStorage {
  return new FilePatchStorage(join(mkdtempSync(join(tmpdir(), 'aip-patches-')), 'patches'));
}

describe('file patch storage', () => {
  it('puts, gets and removes a patch under the run directory', async () => {
    const files = storage();
    const uri = await files.put('run1', 'abc', Buffer.from([1, 2, 255]));
    expect(uri).toMatch(/^file:\/\/\/.*\/run1\/abc\.patch$/);
    expect(await files.get(uri)).toEqual(Buffer.from([1, 2, 255]));
    await files.remove(uri);
    expect(await files.get(uri)).toBeNull();
  });

  it('gives null for an unknown scheme or a path outside the root', async () => {
    const files = storage();
    expect(await files.get('s3://bucket/run1/abc.patch')).toBeNull();
    expect(await files.get('file:///etc/passwd')).toBeNull();
    await files.remove('s3://bucket/run1/abc.patch');
    expect(storageFor([files], 's3://bucket/x')).toBeNull();
    expect(storageFor([files], 'file:///x')).toBe(files);
  });

  it('sweeps directories of unknown runs and stray files of known ones', async () => {
    const files = storage();
    const kept = await files.put('known', 'new', Buffer.from('a'));
    const stray = await files.put('known', 'old', Buffer.from('b'));
    const orphan = await files.put('gone', 'x', Buffer.from('c'));
    await files.sweep(new Map([['known', kept]]));
    expect(await files.get(kept)).not.toBeNull();
    expect(await files.get(stray)).toBeNull();
    expect(await files.get(orphan)).toBeNull();
    expect(existsSync(join(files.root, 'gone'))).toBe(false);
  });

  it('sweeps nothing when the root does not exist', async () => {
    const files = storage();
    await files.sweep(new Map());
    mkdirSync(files.root, { recursive: true });
    writeFileSync(join(files.root, 'file'), '');
    await files.sweep(new Map());
  });
});
