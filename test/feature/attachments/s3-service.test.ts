import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AttachmentRepository,
  FileAttachmentStorage,
  S3AttachmentStorage,
} from '../../../src/feature/attachments/repositories/index.ts';
import { AttachmentService } from '../../../src/feature/attachments/services/index.ts';
import type { AttachmentSettings } from '../../../src/feature/swarm-config/types/index.ts';
import { S3Client } from '../../../src/platform/s3/client.ts';
import { temporaryStorage } from '../storage.ts';
import { startFakeS3Server } from '../../fakes/s3-server.ts';

const local = {
  storage: 'local' as const,
  s3: {
    bucket: 'bucket',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    prefix: 'aip/attachments/',
    pathStyle: true,
  },
};
const credentials = { accessKeyId: 'key', secretAccessKey: 'secret' };
const s3Storage = (settings: AttachmentSettings['s3']) =>
  new S3AttachmentStorage(
    settings,
    new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      pathStyle: settings.pathStyle,
      credentials,
    }),
  );

describe('attachment selection by current settings and URI', () => {
  it('preserves local bytes after switching to S3, reads S3, and sweeps only recorded objects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-s3-service-'));
    const source = join(root, 'shot.png');
    writeFileSync(source, 'picture');
    const objects = new Map<string, string>([['/bucket/aip/attachments/foreign', 'foreign']]);
    const calls: string[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const key = new URL(String(input)).pathname;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${key}`);
      if (method === 'PUT') {
        objects.set(key, Buffer.from(init!.body as Uint8Array).toString());
        return new Response(null, { status: 200 });
      }
      if (method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return objects.has(key)
        ? new Response(objects.get(key), { status: 200 })
        : new Response(null, { status: 404 });
    });
    try {
      const repo = new AttachmentRepository(temporaryStorage().database);
      let current: 'local' | 's3' = 'local';
      const service = new AttachmentService({
        attachments: repo,
        storages: [new FileAttachmentStorage(join(root, 'attachments'))],
        now: () => 1,
        attachmentSettings: () => ({ ...local, storage: current }),
        s3Credentials: credentials,
        s3Storage,
      });
      const [old] = await service.ingest({
        repository: '/repo',
        itemId: 'old',
        sources: [{ path: source }],
      });
      current = 's3';
      const [next] = await service.ingest({
        repository: '/repo',
        itemId: 'new',
        sources: [{ path: source }],
      });
      expect(repo.byId(old!.id)?.uri).toMatch(/^file:/);
      expect(repo.byId(next!.id)?.uri).toBe(`s3://bucket/aip/attachments/${next!.id}`);
      service.bindToRun('old', 'old-run');
      service.bindToRun('new', 'new-run');
      expect((await service.content('old-run', old!.id)).bytes.toString()).toBe('picture');
      expect((await service.content('new-run', next!.id)).bytes.toString()).toBe('picture');
      objects.delete(`/bucket/aip/attachments/${next!.id}`);
      await expect(service.content('new-run', next!.id)).rejects.toThrow('not available');
      await service.sweep({ items: new Set(), hasRun: () => false });
      expect(objects.get('/bucket/aip/attachments/foreign')).toBe('foreign');
      expect(calls).not.toContain('DELETE /bucket/aip/attachments/foreign');
    } finally {
      fetcher.mockRestore();
    }
  });

  it('rejects S3 without credentials before writing any bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-s3-no-keys-'));
    const source = join(root, 'x.txt');
    writeFileSync(source, 'x');
    const repo = new AttachmentRepository(temporaryStorage().database);
    const service = new AttachmentService({
      attachments: repo,
      storages: [new FileAttachmentStorage(join(root, 'attachments'))],
      now: () => 1,
      attachmentSettings: () => ({ ...local, storage: 's3' }),
      s3Credentials: null,
    });
    await expect(
      service.ingest({ repository: '/repo', itemId: 'q', sources: [{ path: source }] }),
    ).rejects.toThrow('no S3 credentials in the daemon environment');
    expect(repo.all()).toEqual([]);
  });

  it('rolls back the first object when the second PUT fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-s3-rollback-'));
    const first = join(root, 'first.txt');
    const second = join(root, 'second.txt');
    writeFileSync(first, 'one');
    writeFileSync(second, 'two');
    const objects = new Set<string>();
    let puts = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const key = new URL(String(input)).pathname;
      if (init?.method === 'PUT') {
        if (++puts === 2) return new Response('Access Denied', { status: 403 });
        objects.add(key);
      }
      if (init?.method === 'DELETE') objects.delete(key);
      return new Response(null, { status: 200 });
    });
    try {
      const repo = new AttachmentRepository(temporaryStorage().database);
      const service = new AttachmentService({
        attachments: repo,
        storages: [new FileAttachmentStorage(join(root, 'attachments'))],
        now: () => 1,
        attachmentSettings: () => ({ ...local, storage: 's3' }),
        s3Credentials: credentials,
        s3Storage,
      });
      await expect(
        service.ingest({
          repository: '/repo',
          itemId: 'q',
          sources: [{ path: first }, { path: second }],
        }),
      ).rejects.toThrow('HTTP 403');
      expect(objects.size).toBe(0);
      expect(repo.all()).toEqual([]);
    } finally {
      fetcher.mockRestore();
    }
  });

  it('detaches local bytes after switching to S3 without credentials or any S3 request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-s3-detach-'));
    const source = join(root, 'old.txt');
    writeFileSync(source, 'old');
    const repo = new AttachmentRepository(temporaryStorage().database);
    let current: 'local' | 's3' = 'local';
    const storage = new FileAttachmentStorage(join(root, 'attachments'));
    const s3 = vi.fn();
    const service = new AttachmentService({
      attachments: repo,
      storages: [storage],
      now: () => 1,
      attachmentSettings: () => ({ ...local, storage: current }),
      s3Credentials: null,
      s3Storage: s3,
    });
    const [ref] = await service.ingest({
      repository: '/repo',
      itemId: 'q',
      sources: [{ path: source }],
    });
    const uri = repo.byId(ref!.id)!.uri;
    expect(uri).toMatch(/^file:/);
    expect(await storage.get(uri)).toEqual(Buffer.from('old'));
    current = 's3';
    expect(
      await service.ingest({ repository: '/repo', itemId: 'q', sources: [], detach: ['old.txt'] }),
    ).toEqual([]);
    expect(repo.ofItem('q')).toEqual([]);
    expect(await storage.get(uri)).toBeNull();
    expect(s3).not.toHaveBeenCalled();
    expect(existsSync(source)).toBe(true);
  });

  it('logs S3 failures without leaking credentials during reads, deletion, or sweep', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-s3-errors-'));
    const source = join(root, 'one.txt');
    writeFileSync(source, 'one');
    const secret = {
      accessKeyId: 'key-sensitive',
      secretAccessKey: 'secret-sensitive',
      sessionToken: 'token-sensitive',
    };
    const server = await startFakeS3Server(secret);
    const settings = {
      ...local,
      storage: 's3' as const,
      s3: { ...local.s3, endpoint: server.endpoint },
    };
    const log = vi.fn();
    const repo = new AttachmentRepository(temporaryStorage().database);
    const service = new AttachmentService({
      attachments: repo,
      storages: [new FileAttachmentStorage(join(root, 'attachments'))],
      now: () => 1,
      attachmentSettings: () => settings,
      s3Credentials: secret,
      s3Storage: (s3) =>
        new S3AttachmentStorage(
          s3,
          new S3Client({
            region: s3.region,
            endpoint: s3.endpoint,
            pathStyle: true,
            credentials: secret,
          }),
        ),
      log,
    });
    try {
      const [ref] = await service.ingest({
        repository: '/repo',
        itemId: 'q',
        sources: [{ path: source }],
      });
      service.bindToRun('q', 'run');
      server.fail = () =>
        `<Error><Code>InvalidAccessKeyId</Code><AccessKeyId>${secret.accessKeyId}</AccessKeyId><Message>${secret.secretAccessKey} x-amz-security-token:${secret.sessionToken}</Message></Error>`;
      await expect(service.content('run', ref!.id)).rejects.toThrow('not available');
      await service.sweep({ items: new Set(), hasRun: () => false });
      expect(log).toHaveBeenCalled();
      expect(log.mock.calls.flat().join('\n')).toContain('HTTP 403: InvalidAccessKeyId');
      for (const value of Object.values(secret))
        expect(log.mock.calls.flat().join('\n')).not.toContain(value);
    } finally {
      await server.close();
    }
  });

  it.each(['reports#/', 'reports%2F/', 'reports? /', 'отчёты /', 'literal%/'])(
    'rolls back the exact S3 key after a later PUT fails with prefix %s',
    async (prefix) => {
      const root = mkdtempSync(join(tmpdir(), 'aip-s3-rollback-fake-'));
      const first = join(root, 'first.txt');
      const second = join(root, 'second.txt');
      writeFileSync(first, 'one');
      writeFileSync(second, 'two');
      const server = await startFakeS3Server(credentials);
      let puts = 0;
      server.fail = (method) => (method === 'PUT' && ++puts === 2 ? 'AccessDenied' : null);
      const repo = new AttachmentRepository(temporaryStorage().database);
      const service = new AttachmentService({
        attachments: repo,
        storages: [new FileAttachmentStorage(join(root, 'attachments'))],
        now: () => 1,
        attachmentSettings: () => ({
          ...local,
          storage: 's3',
          s3: { ...local.s3, endpoint: server.endpoint, prefix },
        }),
        s3Credentials: credentials,
        s3Storage,
      });
      try {
        await expect(
          service.ingest({
            repository: '/repo',
            itemId: 'q',
            sources: [{ path: first }, { path: second }],
          }),
        ).rejects.toThrow('HTTP 403');
        expect(repo.all()).toEqual([]);
        expect(server.objects.size).toBe(0);
        const [put, , deleted] = server.requests;
        expect(put!.method).toBe('PUT');
        expect(deleted!.method).toBe('DELETE');
        expect(deleted!.key).toBe(put!.key);
        expect(put!.key.startsWith(prefix)).toBe(true);
      } finally {
        await server.close();
      }
    },
  );
});
