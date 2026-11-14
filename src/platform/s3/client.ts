import { signS3Request } from './sigv4.ts';

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3ClientOptions {
  region: string;
  endpoint: string | null;
  pathStyle: boolean;
  credentials: S3Credentials;
}

export class S3Client {
  private readonly options: S3ClientOptions;

  constructor(options: S3ClientOptions) {
    this.options = options;
  }

  private address(bucket: string, key: string): URL {
    const { endpoint, region, pathStyle } = this.options;
    // WHATWG URL silently removes these segments, changing the object addressed by the request.
    if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error('S3 object key contains a dot segment');
    }
    const url = new URL(endpoint ?? `https://s3.${region}.amazonaws.com`);
    if (!pathStyle) url.hostname = `${bucket}.${url.hostname}`;
    // Preserve an endpoint base path (e.g. an S3-compatible gateway), and encode each
    // segment independently so that key slashes stay path separators.
    const prefix = url.pathname.replace(/\/$/, '');
    url.pathname = `${prefix}/${pathStyle ? `${encodeURIComponent(bucket)}/` : ''}${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    return url;
  }

  private async request(
    method: string,
    bucket: string,
    key: string,
    bytes?: Buffer,
  ): Promise<Response> {
    const url = this.address(bucket, key);
    const headers = signS3Request({
      method,
      url,
      region: this.options.region,
      credentials: this.options.credentials,
      bytes,
    });
    const response = await fetch(url, {
      method,
      headers,
      body: bytes ? new Uint8Array(bytes) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && !(method === 'GET' && response.status === 404)) {
      const text = await response.text();
      // S3 error bodies can include the access key and the full canonical request (including
      // the session token). Never forward arbitrary server text to callers or logs.
      const code =
        /<Code>\s*([A-Za-z]+)\s*<\/Code>/.exec(text)?.[1] ??
        /^([A-Za-z]+)(?::|\s|$)/.exec(text)?.[1];
      const safeCode =
        code &&
        new Set([
          'AccessDenied',
          'InvalidAccessKeyId',
          'SignatureDoesNotMatch',
          'NoSuchBucket',
          'InvalidBucketName',
          'RequestTimeout',
          'SlowDown',
        ]).has(code)
          ? `: ${code}`
          : '';
      throw new Error(`S3 ${method} ${bucket}/${key}: HTTP ${response.status}${safeCode}`);
    }
    return response;
  }

  async put(bucket: string, key: string, bytes: Buffer): Promise<void> {
    await this.request('PUT', bucket, key, bytes);
  }

  async get(bucket: string, key: string): Promise<Buffer | null> {
    const response = await this.request('GET', bucket, key);
    return response.status === 404 ? null : Buffer.from(await response.arrayBuffer());
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.request('DELETE', bucket, key);
  }
}
