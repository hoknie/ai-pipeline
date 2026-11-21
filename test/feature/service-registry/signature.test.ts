import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SIGNATURE_WINDOW_SECONDS,
  verifyStandardWebhook,
} from '../../../src/feature/service-registry/services/signature.ts';

// The reference vector of the Standard Webhooks specification.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TIMESTAMP = '1614265330';
const BODY = new TextEncoder().encode('{"test": 2432232314}');
const SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const NOW = 1614265330 * 1000;

const check = (overrides: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}): boolean =>
  verifyStandardWebhook({
    secret: SECRET,
    id: ID,
    timestamp: TIMESTAMP,
    signatures: SIGNATURE,
    body: BODY,
    now: NOW,
    ...overrides,
  });

describe('Standard Webhooks signature', () => {
  it('accepts the reference vector, with and without the whsec_ prefix', () => {
    expect(check()).toBe(true);
    expect(check({ secret: SECRET.slice('whsec_'.length) })).toBe(true);
  });

  it('refuses another key, another id, another time and a changed byte of the body', () => {
    expect(check({ secret: 'whsec_' + Buffer.from('other-key').toString('base64') })).toBe(false);
    expect(check({ id: 'msg_other' })).toBe(false);
    expect(check({ timestamp: '1614265331' })).toBe(false);
    const changed = BODY.slice();
    changed[3] = (changed[3] ?? 0) ^ 1;
    expect(check({ body: changed })).toBe(false);
  });

  it('takes any v1 item of a list and ignores other versions and garbage', () => {
    expect(check({ signatures: `v1,AAAA ${SIGNATURE}` })).toBe(true);
    expect(check({ signatures: `${SIGNATURE} v1,AAAA` })).toBe(true);
    expect(check({ signatures: `v2,${SIGNATURE.slice(3)}` })).toBe(false);
    expect(check({ signatures: SIGNATURE.slice(3) })).toBe(false);
    expect(check({ signatures: 'v1,' })).toBe(false);
  });

  it('keeps the window of five minutes in both directions', () => {
    const edge = SIGNATURE_WINDOW_SECONDS * 1000;
    expect(check({ now: NOW + edge })).toBe(true);
    expect(check({ now: NOW - edge })).toBe(true);
    expect(check({ now: NOW + edge + 1000 })).toBe(false);
    expect(check({ now: NOW - edge - 1000 })).toBe(false);
  });

  it('refuses missing or malformed parts', () => {
    expect(check({ id: '' })).toBe(false);
    expect(check({ timestamp: '' })).toBe(false);
    expect(check({ signatures: '' })).toBe(false);
    expect(check({ secret: '' })).toBe(false);
    expect(check({ timestamp: 'abc' })).toBe(false);
    expect(check({ timestamp: '1e9' })).toBe(false);
    expect(check({ secret: 'whsec_not base64!' })).toBe(false);
  });

  it('agrees with an independent computation of the same scheme', () => {
    const key = Buffer.from('k'.repeat(24));
    const body = new TextEncoder().encode('{"type":"x"}');
    const mac = createHmac('sha256', key).update(`i1.${TIMESTAMP}.`).update(body).digest('base64');
    expect(
      check({
        secret: `whsec_${key.toString('base64')}`,
        id: 'i1',
        body,
        signatures: `v1,${mac}`,
      }),
    ).toBe(true);
  });
});
