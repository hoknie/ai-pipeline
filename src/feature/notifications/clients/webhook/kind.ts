import type { AdapterDescriptor } from '../../../integrations/types/index.ts';

import { WEBHOOK_KIND } from '../../types/index.ts';

export { WEBHOOK_KIND };
export const WEBHOOK_SECRET_SLOT = 'signing_secret';
/** The longest address a webhook may have. */
export const URL_LIMIT = 2048;
/** The shortest secret that is accepted. */
export const SECRET_MIN_BYTES = 24;
export const WEBHOOK_CREATED_BY = 'aip webhook add';

/** Whether the text is an absolute http(s) address without a login, a password or an empty host. */
export function isWebhookUrl(value: string): boolean {
  if (value.length > URL_LIMIT) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === ''
  );
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `whsec_<base64>` or any text of at least 24 bytes. */
export function isSigningSecret(value: string): boolean {
  if (new TextEncoder().encode(value).length < SECRET_MIN_BYTES) return false;
  return !value.startsWith('whsec_') || BASE64.test(value.slice('whsec_'.length));
}

/** What the catalog of integrations knows about the kind: the address and the signing secret. */
export const webhookDescriptor: AdapterDescriptor = {
  kind: WEBHOOK_KIND,
  title: 'Outgoing webhook',
  params: [{ name: 'url', required: true, maxLength: URL_LIMIT, validate: isWebhookUrl }],
  secrets: [{ slot: WEBHOOK_SECRET_SLOT, required: true, validate: isSigningSecret }],
  directions: ['outbound'],
  operations: [],
  createdBy: WEBHOOK_CREATED_BY,
};

/** The adapter of the integrations: the kind has no operations beyond what its channel does. */
export function webhookAdapter(): { descriptor: AdapterDescriptor } {
  return { descriptor: webhookDescriptor };
}

/** The key of the signature from the secret: the decoded bytes of `whsec_<base64>`, else the text. */
export function signingKey(secret: string): Buffer {
  return secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
}
