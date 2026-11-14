import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { S3Credentials } from '../../src/platform/s3/client.ts';

function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mac(key: Uint8Array | string, text: string): Buffer {
  return createHmac('sha256', key).update(text).digest();
}

function encoded(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface FakeS3Server {
  endpoint: string;
  objects: Map<string, Buffer>;
  requests: { method: string; bucket: string; key: string; host: string }[];
  fail: ((method: string, bucket: string, key: string) => string | null) | null;
  close(): Promise<void>;
}

/** In-memory, signature-checking S3-compatible HTTP endpoint for client/storage tests. */
export async function startFakeS3Server(
  credentials: S3Credentials,
  region = 'us-east-1',
): Promise<FakeS3Server> {
  const objects = new Map<string, Buffer>();
  const requests: FakeS3Server['requests'] = [];
  const fake: FakeS3Server = {
    endpoint: '',
    objects,
    requests,
    fail: null,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (!verify(request, body, credentials, region)) {
      respond(response, 403, 'Invalid signature');
      return;
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const [bucket = '', ...parts] = url.pathname.slice(1).split('/');
    const key = decodeURIComponent(parts.join('/'));
    const name = `${bucket}/${key}`;
    const method = request.method ?? '';
    requests.push({ method, bucket, key, host: request.headers.host ?? '' });
    const error = fake.fail?.(method, bucket, key);
    if (error) {
      respond(response, 403, error);
    } else if (method === 'PUT') {
      objects.set(name, body);
      respond(response, 200);
    } else if (method === 'GET') {
      const object = objects.get(name);
      respond(response, object ? 200 : 404, object);
    } else if (method === 'DELETE') {
      objects.delete(name);
      respond(response, 204);
    } else {
      respond(response, 405);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}

function respond(response: ServerResponse, status: number, body?: Buffer | string): void {
  response.writeHead(status);
  response.end(body);
}

function verify(
  request: IncomingMessage,
  body: Buffer,
  credentials: S3Credentials,
  region: string,
): boolean {
  const auth = request.headers.authorization;
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(
      auth ?? '',
    );
  if (!match || match[1] !== credentials.accessKeyId || match[3] !== region) return false;
  const [, , date, , signed, signature] = match;
  const timestamp = request.headers['x-amz-date'];
  const payloadHash = hash(body);
  if (
    typeof timestamp !== 'string' ||
    !timestamp.startsWith(date ?? '') ||
    request.headers['x-amz-content-sha256'] !== payloadHash ||
    request.headers['x-amz-security-token'] !== credentials.sessionToken
  )
    return false;
  const names = signed!.split(';');
  if (names.some((name) => typeof request.headers[name] !== 'string')) return false;
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const path = url.pathname
    .split('/')
    .map((segment) => encoded(decodeURIComponent(segment)))
    .join('/');
  const query = [...url.searchParams]
    .map(([key, value]) => `${encoded(key)}=${encoded(value)}`)
    .sort()
    .join('&');
  const canonicalHeaders = names
    .map((name) => `${name}:${(request.headers[name] as string).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonical = [request.method, path, query, canonicalHeaders, signed, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const key = mac(
    mac(mac(mac(`AWS4${credentials.secretAccessKey}`, date!), region), 's3'),
    'aws4_request',
  );
  return mac(key, toSign).toString('hex') === signature;
}
