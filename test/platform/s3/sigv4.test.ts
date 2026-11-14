import { describe, expect, it } from 'vitest';

import { signS3Request } from '../../../src/platform/s3/sigv4.ts';

const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

describe('S3 Signature V4', () => {
  it('signs the AWS GET Object example request (test.txt, bytes 0-9, 2013-05-24)', () => {
    const headers = signS3Request({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      credentials,
      headers: new Headers({ range: 'bytes=0-9' }),
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.get('x-amz-date')).toBe('20130524T000000Z');
    expect(headers.get('x-amz-content-sha256')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=67fe34c8530db585abddc51067328adfedb6e42487d2566dc7d927d6e2722900',
    );
  });

  it('signs the session token and actual payload bytes', () => {
    const headers = signS3Request({
      method: 'PUT',
      url: new URL('http://localhost:9000/bucket/a%20b/file.txt'),
      region: 'us-east-1',
      credentials: { ...credentials, sessionToken: 'temporary-token' },
      bytes: Buffer.from('hello'),
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.get('x-amz-content-sha256')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(headers.get('x-amz-security-token')).toBe('temporary-token');
    expect(headers.get('authorization')).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token',
    );
  });
});
