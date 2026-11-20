import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AttachmentRepository,
  FileAttachmentStorage,
  attachmentStorageFor,
  type AttachmentRecord,
} from '../../../src/feature/attachments/repositories/index.ts';
import { temporaryStorage } from '../storage.ts';

function record(id: string, itemId: string, fileName: string, uri = `file:///x/${id}`) {
  return {
    id,
    repository: '/repo',
    itemId,
    runId: null,
    fileName,
    size: 1,
    mediaType: 'text/plain',
    uri,
    createdAt: 1,
  } satisfies AttachmentRecord;
}

describe('FileAttachmentStorage', () => {
  const root = () => join(mkdtempSync(join(tmpdir(), 'aip-att-')), 'attachments');

  it('puts, gets and removes bytes with private permissions', async () => {
    const storage = new FileAttachmentStorage(root());
    const uri = await storage.put('owner', 'a1', Buffer.from('bytes'));
    expect(uri.startsWith('file:')).toBe(true);
    expect((await storage.get(uri))?.toString()).toBe('bytes');
    expect(statSync(join(storage.root, 'owner')).mode & 0o777).toBe(0o700);
    expect(statSync(join(storage.root, 'owner', 'a1')).mode & 0o777).toBe(0o600);
    await storage.remove(uri);
    expect(await storage.get(uri)).toBeNull();
  });

  it('does not touch a link of another scheme or a path outside its root', async () => {
    const storage = new FileAttachmentStorage(root());
    expect(storage.handles('s3://bucket/a')).toBe(false);
    expect(await storage.get('s3://bucket/a')).toBeNull();
    await storage.remove('s3://bucket/a');
    const outside = join(mkdtempSync(join(tmpdir(), 'aip-out-')), 'f');
    writeFileSync(outside, 'keep');
    await storage.remove(`file://${outside}`);
    expect(existsSync(outside)).toBe(true);
    expect(await storage.get(`file://${outside}`)).toBeNull();
  });

  it('sweeps owners and files that are not kept', async () => {
    const storage = new FileAttachmentStorage(root());
    const kept = await storage.put('owner', 'a1', Buffer.from('1'));
    await storage.put('owner', 'a2', Buffer.from('2'));
    await storage.put('gone', 'a3', Buffer.from('3'));
    mkdirSync(join(storage.root, 'empty'));
    await storage.sweep(new Map([['owner', [kept]]]));
    expect(existsSync(join(storage.root, 'owner', 'a1'))).toBe(true);
    expect(existsSync(join(storage.root, 'owner', 'a2'))).toBe(false);
    expect(existsSync(join(storage.root, 'gone'))).toBe(false);
    expect(existsSync(join(storage.root, 'empty'))).toBe(false);
  });

  it('picks the storage by the scheme', () => {
    const storage = new FileAttachmentStorage(root());
    expect(attachmentStorageFor([storage], 'file:///a')).toBe(storage);
    expect(attachmentStorageFor([storage], 's3://a')).toBeNull();
  });

  it('reads the bytes it wrote', async () => {
    const storage = new FileAttachmentStorage(root());
    const uri = await storage.put('o', 'k', Buffer.from('abc'));
    expect(readFileSync(new URL(uri)).toString()).toBe('abc');
  });
});

describe('AttachmentRepository', () => {
  it('adds records together and lists them by item', () => {
    const repository = new AttachmentRepository(temporaryStorage().database);
    repository.add([record('a1', 'q1', 'a.txt'), record('a2', 'q1', 'b.txt')]);
    expect(repository.ofItem('q1').map((item) => item.fileName)).toEqual(['a.txt', 'b.txt']);
    expect(repository.byId('a2')?.fileName).toBe('b.txt');
    expect(repository.all()).toHaveLength(2);
  });

  it('refuses a repeated name of an item and records nothing of that request', () => {
    const repository = new AttachmentRepository(temporaryStorage().database);
    repository.add([record('a1', 'q1', 'a.txt')]);
    expect(() =>
      repository.add([record('a2', 'q1', 'b.txt'), record('a3', 'q1', 'a.txt')]),
    ).toThrow();
    expect(repository.ofItem('q1')).toHaveLength(1);
  });

  it('hands the records of an item to a run, and finds them by run and id', () => {
    const repository = new AttachmentRepository(temporaryStorage().database);
    repository.add([record('a1', 'q1', 'a.txt'), record('a2', 'q2', 'a.txt')]);
    repository.bindToRun('q1', 'r1');
    expect(repository.ofRun('r1').map((item) => item.id)).toEqual(['a1']);
    expect(repository.inRun('r1', 'a1')?.fileName).toBe('a.txt');
    expect(repository.inRun('r1', 'a2')).toBeNull();
    expect(repository.inRun('r2', 'a1')).toBeNull();
  });

  it('removes only the records no run owns, optionally by name', () => {
    const repository = new AttachmentRepository(temporaryStorage().database);
    repository.add([record('a1', 'q1', 'a.txt'), record('a2', 'q1', 'b.txt')]);
    expect(repository.removeOfItem('q1', ['a.txt']).map((item) => item.id)).toEqual(['a1']);
    repository.bindToRun('q1', 'r1');
    expect(repository.removeOfItem('q1')).toEqual([]);
    expect(repository.ofRun('r1')).toHaveLength(1);
  });

  it('replaces records in one transaction', () => {
    const repository = new AttachmentRepository(temporaryStorage().database);
    repository.add([record('a1', 'q1', 'a.txt')]);
    repository.add([record('a2', 'q1', 'a.txt')], ['a1']);
    expect(repository.ofItem('q1').map((item) => item.id)).toEqual(['a2']);
  });
});
