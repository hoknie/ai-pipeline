import { describe, expect, it, vi } from 'vitest';

import { S3AttachmentStorage } from '../../../src/feature/attachments/repositories/index.ts';
import { S3Client } from '../../../src/platform/s3/client.ts';
import { startFakeS3Server } from '../../fakes/s3-server.ts';

const settings = {
  bucket: 'my-bucket',
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  prefix: 'aip/attachments/',
  pathStyle: true,
};
const credentials = { accessKeyId: 'test', secretAccessKey: 'secret' };

describe('S3AttachmentStorage', () => {
  it('writes an id-based object and reads/removes the bucket named by the URI', async () => {
    const requests: { method: string; url: string; body: string }[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({
        method: init?.method ?? 'GET',
        url: String(input),
        body: init?.body ? Buffer.from(init.body as Uint8Array).toString() : '',
      });
      return new Response(init?.method === 'GET' ? 'bytes' : null, { status: 200 });
    });
    try {
      const storage = new S3AttachmentStorage(
        settings,
        new S3Client({
          region: settings.region,
          endpoint: settings.endpoint,
          pathStyle: settings.pathStyle,
          credentials,
        }),
      );
      const uri = await storage.put('owner', 'id-1', Buffer.from('bytes'));
      expect(uri).toBe('s3://my-bucket/aip/attachments/id-1');
      expect(storage.handles(uri)).toBe(true);
      expect(await storage.get('s3://other-bucket/old/id-2')).toEqual(Buffer.from('bytes'));
      await storage.remove(uri);
      await storage.sweep(new Map());
      expect(requests.map(({ method, url }) => [method, url])).toEqual([
        ['PUT', 'http://localhost:9000/my-bucket/aip/attachments/id-1'],
        ['GET', 'http://localhost:9000/other-bucket/old/id-2'],
        ['DELETE', 'http://localhost:9000/my-bucket/aip/attachments/id-1'],
      ]);
      expect(requests[0]?.body).toBe('bytes');
    } finally {
      fetcher.mockRestore();
    }
  });

  it.each(['reports#/', 'reports%2F/', 'reports? /', 'отчёты /', 'literal%/'])(
    'round-trips a key with prefix %s through a signed fake S3 server',
    async (prefix) => {
      const server = await startFakeS3Server(credentials);
      const key = `${prefix}id-1`;
      const storage = new S3AttachmentStorage(
        { ...settings, endpoint: server.endpoint, prefix },
        new S3Client({
          region: settings.region,
          endpoint: server.endpoint,
          pathStyle: true,
          credentials,
        }),
      );
      try {
        const uri = await storage.put('owner', 'id-1', Buffer.from('bytes'));
        expect(server.objects.get(`my-bucket/${key}`)).toEqual(Buffer.from('bytes'));
        expect(await storage.get(uri)).toEqual(Buffer.from('bytes'));
        await storage.remove(uri);
        expect(server.objects.size).toBe(0);
        expect(server.requests.map((request) => request.key)).toEqual([key, key, key]);
      } finally {
        await server.close();
      }
    },
  );
});
