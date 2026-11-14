import { createHash, createHmac } from 'node:crypto';

import type { S3Credentials } from './client.ts';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Sign a single S3 request, including its exact payload bytes. Does not mutate the input headers. */
export function signS3Request(options: {
  method: string;
  url: URL;
  region: string;
  credentials: S3Credentials;
  bytes?: Uint8Array;
  headers?: Headers;
  now?: Date;
}): Headers {
  const { method, url, region, credentials } = options;
  const headers = new Headers(options.headers);
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const payloadHash = options.bytes ? sha256(options.bytes) : EMPTY_SHA256;
  headers.set('host', url.host);
  headers.set('x-amz-date', timestamp);
  headers.set('x-amz-content-sha256', payloadHash);
  if (credentials.sessionToken) headers.set('x-amz-security-token', credentials.sessionToken);

  const signedNames = [...headers.keys()].filter((name) => name !== 'authorization').sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${headers.get(name)!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonicalPath = url.pathname
    .split('/')
    .map((part) => encode(decodeURIComponent(part)))
    .join('/');
  const canonicalQuery = [...url.searchParams]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    sha256(Buffer.from(canonicalRequest)),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), 's3'),
    'aws4_request',
  );
  const signature = hmac(signingKey, stringToSign).toString('hex');
  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`,
  );
  return headers;
}
