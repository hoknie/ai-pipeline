import { createHmac } from 'node:crypto';

import { signingKey } from './kind.ts';

/** The headers of Standard Webhooks for one request: the id, the time in seconds and the signature. */
export function signedHeaders(
  secret: string,
  id: string,
  seconds: number,
  body: Uint8Array,
): Record<string, string> {
  const signature = createHmac('sha256', signingKey(secret))
    .update(`${id}.${seconds}.`)
    .update(body)
    .digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(seconds),
    'webhook-signature': `v1,${signature}`,
  };
}
