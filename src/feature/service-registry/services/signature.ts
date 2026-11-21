import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far the time of a delivery may be from the time of the daemon, in seconds. */
export const SIGNATURE_WINDOW_SECONDS = 300;

export interface StandardWebhook {
  /** The secret of the connection, `whsec_` and the base64 key. */
  secret: string;
  id: string;
  timestamp: string;
  /** The value of `webhook-signature`: `v1,<base64>` items separated by spaces. */
  signatures: string;
  body: Uint8Array;
  /** Now, in milliseconds. */
  now: number;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Checks a delivery signed by the Standard Webhooks scheme: HMAC-SHA256 over
 * `<id>.<timestamp>.<raw body>`, compared in constant time with every `v1` item.
 */
export function verifyStandardWebhook(webhook: StandardWebhook): boolean {
  const { secret, id, timestamp, signatures, body, now } = webhook;
  if (id === '' || timestamp === '' || signatures === '' || secret === '') return false;
  if (!/^[0-9]{1,15}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!BASE64.test(encoded)) return false;
  const key = Buffer.from(encoded, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest();
  let matched = false;
  for (const item of signatures.split(' ')) {
    if (!item.startsWith('v1,')) continue;
    const given = Buffer.from(item.slice(3), 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  return matched;
}
