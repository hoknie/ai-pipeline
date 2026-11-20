import { describe, expect, it } from 'vitest';

import {
  isSigningSecret,
  isWebhookUrl,
  signingKey,
  webhookAdapter,
  webhookDescriptor,
} from '../../../src/feature/notifications/clients/webhook/kind.ts';
import {
  checkSecretFormat,
  failureCode,
  secretSpec,
  validateParams,
} from '../../../src/feature/integrations/types/index.ts';
import { displayUrl } from '../../../src/feature/notifications/types/index.ts';
import { builtInAdapters } from '../../../src/app/notifications/index.ts';
import { fixture } from '../integrations/helpers.ts';

const params = (url: string) => () => validateParams(webhookDescriptor, { url });

describe('webhook kind: the address', () => {
  it('accepts http and https addresses, loopback included', () => {
    expect(params('https://ci.example.com/hook?token=abc')()).toEqual({
      url: 'https://ci.example.com/hook?token=abc',
    });
    expect(params('http://127.0.0.1:8080/hook')()).toEqual({ url: 'http://127.0.0.1:8080/hook' });
  });

  it('refuses a password, another scheme, no host, a relative address and a long one', () => {
    for (const url of [
      'https://user:pass@example.com/hook',
      'https://user@example.com/hook',
      'ftp://example.com/hook',
      '/hook',
      'not a url',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(params(url)).toThrow();
      expect(isWebhookUrl(url)).toBe(false);
    }
    expect(
      failureCode(
        (() => {
          try {
            params('ftp://x.example.com')();
          } catch (e) {
            return e;
          }
        })(),
      ),
    ).toBe('invalid_params');
  });

  it('names the parameter and not its value in the refusal', () => {
    try {
      params('https://user:secret-pass@example.com')();
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).toContain('url');
      expect(String((error as Error).message)).not.toContain('secret-pass');
    }
  });

  it('shows an address without its query, fragment and login', () => {
    expect(displayUrl('https://ci.example.com/hook?token=abc#x')).toBe(
      'https://ci.example.com/hook',
    );
    expect(displayUrl('http://127.0.0.1:8080/hook?a=1')).toBe('http://127.0.0.1:8080/hook');
    expect(displayUrl('https://ci.example.com/?token=abc')).toBe('https://ci.example.com');
    expect(displayUrl('nonsense')).toBe('');
  });
});

describe('webhook kind: the secret', () => {
  const spec = secretSpec(webhookDescriptor, 'signing_secret');

  it('takes whsec_ with base64 or any text of 24 bytes', () => {
    expect(isSigningSecret('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).toBe(true);
    expect(isSigningSecret('a'.repeat(24))).toBe(true);
    // the length is counted in bytes, not characters
    expect(isSigningSecret('ключ-ключ')).toBe(false);
    expect(isSigningSecret('ключ-ключ-ключ')).toBe(true);
  });

  it('refuses a short secret and a whsec_ that is not base64', () => {
    expect(() => checkSecretFormat(spec, 'tiny')).toThrow();
    expect(() => checkSecretFormat(spec, 'a'.repeat(23))).toThrow();
    expect(() => checkSecretFormat(spec, `whsec_${'!'.repeat(30)}`)).toThrow();
    expect(() => checkSecretFormat(spec, 'a'.repeat(24))).not.toThrow();
  });

  it('makes the key from the decoded bytes of whsec_, else from the text', () => {
    expect(signingKey('whsec_AAECAw==').equals(Buffer.from([0, 1, 2, 3]))).toBe(true);
    expect(signingKey('plain-secret-of-24-bytes!!').toString('utf8')).toBe(
      'plain-secret-of-24-bytes!!',
    );
  });

  it('is required: a webhook is not enabled without it', async () => {
    const base = fixture({ adapters: [webhookAdapter()] });
    const added = await base.services.connections.add(
      { kind: 'webhook', name: 'ci', global: true, params: { url: 'https://ci.example.com/hook' } },
      { managed: true },
    );
    await expect(base.services.connections.enable(added.id)).rejects.toThrow(/secret/);
    await expect(
      base.services.connections.setSecret(added.id, 'signing_secret', 'tiny'),
    ).rejects.toThrow();
    expect((await base.services.connections.list())[0]?.secrets).toEqual([
      { slot: 'signing_secret', required: true, present: false },
    ]);
  });
});

describe('webhook kind: the catalog', () => {
  it('is among the adapters of this build and is made by its own command', async () => {
    expect(builtInAdapters().map((one) => one.descriptor.kind)).toContain('webhook');
    expect(webhookAdapter().descriptor.createdBy).toBe('aip webhook add');
    const base = fixture({ adapters: [webhookAdapter()] });
    await expect(
      base.services.connections.add({
        kind: 'webhook',
        name: 'ci',
        global: true,
        params: { url: 'https://ci.example.com/hook' },
      }),
    ).rejects.toThrow(/aip webhook add/);
    expect(await base.services.connections.list()).toEqual([]);
  });
});
