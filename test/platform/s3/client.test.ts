import { afterEach, describe, expect, it, vi } from 'vitest';

import { S3Client } from '../../../src/platform/s3/client.ts';
import { startFakeS3Server, type FakeS3Server } from '../../fakes/s3-server.ts';

const credentials = {
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
  sessionToken: 'session',
};

const servers: FakeS3Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function setup(): Promise<{ client: S3Client; server: FakeS3Server }> {
  const server = await startFakeS3Server(credentials);
  servers.push(server);
  return {
    server,
    client: new S3Client({
      endpoint: server.endpoint,
      region: 'us-east-1',
      pathStyle: true,
      credentials,
    }),
  };
}

describe('S3Client', () => {
  it('writes, reads, returns null for 404, and deletes with signed path-style requests', async () => {
    const { client, server } = await setup();
    const bytes = Buffer.from([0, 1, 255]);
    expect(await client.get('images', 'aip/file')).toBeNull();
    await client.put('images', 'aip/file', bytes);
    expect(server.objects.get('images/aip/file')).toEqual(bytes);
    expect(await client.get('images', 'aip/file')).toEqual(bytes);
    await client.delete('images', 'aip/file');
    expect(await client.get('images', 'aip/file')).toBeNull();
    expect(server.requests.map(({ method }) => method)).toEqual([
      'GET',
      'PUT',
      'GET',
      'DELETE',
      'GET',
    ]);
  });

  it('retains a safe error code and status but never forwards arbitrary S3 diagnostics', async () => {
    const { client, server } = await setup();
    server.fail = (method) => (method === 'PUT' ? 'AccessDenied: forbidden by policy' : null);
    await expect(client.put('images', 'denied', Buffer.from('x'))).rejects.toThrow(
      'HTTP 403: AccessDenied',
    );
    expect(server.objects.size).toBe(0);
  });

  it('redacts credential-bearing XML and canonical request diagnostics on every operation', async () => {
    const { client, server } = await setup();
    server.fail = () =>
      `<Error><Code>SignatureDoesNotMatch</Code><AccessKeyId>${credentials.accessKeyId}</AccessKeyId><Message>${credentials.secretAccessKey} x-amz-security-token:${credentials.sessionToken}</Message></Error>`;
    for (const operation of [
      () => client.put('images', 'denied', Buffer.from('x')),
      () => client.get('images', 'denied'),
      () => client.delete('images', 'denied'),
    ]) {
      const error: Error = await operation().then(
        () => {
          throw new Error('expected S3 failure');
        },
        (failure: unknown) => failure as Error,
      );
      expect(error.message).toContain('HTTP 403: SignatureDoesNotMatch');
      for (const value of Object.values(credentials)) expect(error.message).not.toContain(value);
    }
  });

  it('rejects dot segments rather than silently targeting a different key', async () => {
    const { client, server } = await setup();
    await expect(client.put('images', 'a/../b', Buffer.from('x'))).rejects.toThrow('dot segment');
    await expect(client.get('images', './b')).rejects.toThrow('dot segment');
    expect(server.requests).toEqual([]);
  });

  it('preserves endpoint paths and encodes key segments without escaping slashes', async () => {
    const { server } = await setup();
    const client = new S3Client({
      endpoint: `${server.endpoint}/gateway/`,
      region: 'us-east-1',
      pathStyle: true,
      credentials,
    });
    await client.put('bucket', 'a b/file%2F.txt', Buffer.from('ok'));
    expect(server.requests[0]).toMatchObject({
      bucket: 'gateway',
      key: 'bucket/a b/file%2F.txt',
    });
  });

  it('uses the regional AWS endpoint and bucket hostname in virtual-host style', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const client = new S3Client({
        endpoint: null,
        region: 'eu-central-1',
        pathStyle: false,
        credentials,
      });
      await client.delete('my-bucket', 'aip/attachments/id');
      const [url, init] = fetcher.mock.calls[0]!;
      expect(String(url)).toBe(
        'https://my-bucket.s3.eu-central-1.amazonaws.com/aip/attachments/id',
      );
      const headers = init?.headers as Headers;
      expect(headers.get('host')).toBe('my-bucket.s3.eu-central-1.amazonaws.com');
      expect(headers.get('authorization')).toContain('/eu-central-1/s3/aws4_request');
    } finally {
      fetcher.mockRestore();
    }
  });
});
