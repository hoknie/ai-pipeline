import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FileArtifactStorage,
  artifactStorageFor,
} from '../../src/feature/artifacts/repositories/index.ts';

function storage(): FileArtifactStorage {
  return new FileArtifactStorage(join(mkdtempSync(join(tmpdir(), 'aip-artifacts-')), 'artifacts'));
}

describe('file artifact storage', () => {
  it('puts, gets and removes an artifact under the run directory with private modes', async () => {
    const files = storage();
    const uri = await files.put('run1', 'id1', Buffer.from([1, 2, 255]));
    expect(uri).toMatch(/^file:\/\/\/.*\/run1\/id1$/);
    expect(await files.get(uri)).toEqual(Buffer.from([1, 2, 255]));
    expect(statSync(join(files.root, 'run1')).mode & 0o777).toBe(0o700);
    expect(statSync(join(files.root, 'run1', 'id1')).mode & 0o777).toBe(0o600);
    await files.remove(uri);
    expect(await files.get(uri)).toBeNull();
  });

  it('replaces the bytes under the same key', async () => {
    const files = storage();
    const first = await files.put('run1', 'id1', Buffer.from('a'));
    const second = await files.put('run1', 'id1', Buffer.from('bb'));
    expect(second).toBe(first);
    expect(await files.get(second)).toEqual(Buffer.from('bb'));
  });

  it('gives null for an unknown scheme or a path outside the root and leaves foreign URIs alone', async () => {
    const files = storage();
    expect(await files.get('s3://bucket/run1/id1')).toBeNull();
    expect(await files.get('file:///etc/passwd')).toBeNull();
    await files.remove('s3://bucket/run1/id1');
    await files.remove('file:///etc/passwd');
    expect(existsSync('/etc/passwd')).toBe(true);
    expect(artifactStorageFor([files], 's3://bucket/x')).toBeNull();
    expect(artifactStorageFor([files], 'file:///x')).toBe(files);
  });

  it('sweeps directories of unknown runs and stray files of known ones', async () => {
    const files = storage();
    const kept = await files.put('known', 'new', Buffer.from('a'));
    const alsoKept = await files.put('known', 'other', Buffer.from('b'));
    const stray = await files.put('known', 'old', Buffer.from('c'));
    const orphan = await files.put('gone', 'x', Buffer.from('d'));
    await files.sweep(new Map([['known', [kept, alsoKept]]]));
    expect(await files.get(kept)).not.toBeNull();
    expect(await files.get(alsoKept)).not.toBeNull();
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
    expect(existsSync(join(files.root, 'file'))).toBe(false);
  });
});
