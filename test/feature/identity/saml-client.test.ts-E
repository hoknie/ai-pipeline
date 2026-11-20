import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { SamlClient } from '../../../src/feature/identity/clients/saml/index.ts';
import {
  IdpMetadataSource,
  METADATA_REFRESH_MS,
  parseIdpMetadata,
} from '../../../src/feature/identity/clients/saml/idp-metadata.ts';
import { FakeKeyPair, FakeSamlIdp, redirectParts } from '../../fakes/saml-provider.ts';

const ENTITY = 'https://aip.example.com/auth/saml/metadata';
const ACS = 'https://aip.example.com/auth/saml/acs';

let idp: FakeSamlIdp;
let service: FakeKeyPair;

beforeAll(() => {
  idp = new FakeSamlIdp();
  service = new FakeKeyPair('aip');
});

function setup(now = () => Date.now()) {
  const directory = mkdtempSync(join(tmpdir(), 'aip-saml-'));
  const file = join(directory, 'idp.xml');
  writeFileSync(file, idp.metadata());
  const known = new Set<string>();
  const warnings: string[] = [];
  const metadata = new IdpMetadataSource({
    location: file,
    copyPath: join(directory, 'copy.xml'),
    now,
    warn: (message) => warnings.push(message),
  });
  const client = new SamlClient({
    entityId: ENTITY,
    acsUrl: ACS,
    privateKey: service.privatePem,
    certificate: service.certificatePem,
    metadata,
    assertions: {
      remember: (id) => {
        if (known.has(id)) return false;
        known.add(id);
        return true;
      },
    },
  });
  return { client, known, warnings, directory };
}

async function accepted(client: SamlClient, samlResponse: string, requestId = 'req-1') {
  return client.validatePostResponse({ samlResponse, requestId });
}

const reply = (options: Partial<Parameters<FakeSamlIdp['response']>[0]> = {}) =>
  idp.response({ requestId: 'req-1', acsUrl: ACS, audience: ENTITY, ...options });

describe('SAML client: responses', () => {
  it('accepts a response with a signed assertion and returns the identity', async () => {
    const { client } = setup();
    const identity = await accepted(
      client,
      reply({ attributes: { mail: 'alice@corp.com', groups: ['a', 'b'] } }),
    );
    expect(identity).toMatchObject({
      issuer: idp.entityId,
      nameId: 'alice-persistent-id',
      nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      attributes: { mail: 'alice@corp.com', groups: ['a', 'b'] },
    });
  });

  it('accepts a response whose Response element is signed', async () => {
    const { client } = setup();
    const identity = await accepted(client, reply({ sign: 'response' }));
    expect(identity.nameId).toBe('alice-persistent-id');
  });

  it('rejects an unsigned response', async () => {
    const { client } = setup();
    await expect(accepted(client, reply({ sign: 'none' }))).rejects.toMatchObject({
      kind: 'rejected',
      code: 'identity.saml_failed',
    });
  });

  it('rejects a response re-signed with another key', async () => {
    const { client } = setup();
    await expect(accepted(client, reply({ sign: 'foreign' }))).rejects.toMatchObject({
      code: 'identity.saml_failed',
    });
  });

  it('rejects a wrong Audience', async () => {
    const { client } = setup();
    await expect(
      accepted(client, reply({ wrongAudience: 'https://other.example.com' })),
    ).rejects.toThrow(/audience/i);
  });

  it('rejects an expired assertion and tolerates a skew of the clocks', async () => {
    const { client } = setup();
    await expect(accepted(client, reply({ shiftMs: -20 * 60_000 }))).rejects.toThrow();
    const skewed = setup();
    expect((await accepted(skewed.client, reply({ shiftMs: -5 * 60_000 - 30_000 }))).nameId).toBe(
      'alice-persistent-id',
    );
  });

  it('rejects an answer to another request', async () => {
    const { client } = setup();
    await expect(accepted(client, reply({ inResponseTo: 'req-2' }))).rejects.toThrow();
  });

  it('rejects another Destination', async () => {
    const { client } = setup();
    await expect(
      accepted(client, reply({ destination: 'https://evil.example.com/auth/saml/acs' })),
    ).rejects.toThrow(/addressed to/);
  });

  it('accepts one assertion once', async () => {
    const { client, known } = setup();
    const response = reply({ assertionId: '_same' });
    await accepted(client, response);
    expect(known.size).toBe(1);
    await expect(accepted(client, response)).rejects.toThrow(/already been received/);
  });

  it('rejects garbage', async () => {
    const { client } = setup();
    await expect(accepted(client, 'not xml')).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('SAML client: request and metadata of the service', () => {
  it('builds a signed redirect to the provider with the request ID and RelayState', async () => {
    const { client } = setup();
    const url = await client.authorizeUrl({ requestId: '_abc123', relayState: 'state-1' });
    expect(url.startsWith(idp.ssoUrl)).toBe(true);
    const parts = redirectParts(url);
    expect(parts.relayState).toBe('state-1');
    expect(parts.requestXml).toContain('ID="_abc123"');
    expect(parts.requestXml).toContain(`AssertionConsumerServiceURL="${ACS}"`);
    expect(new URL(url).searchParams.get('Signature')).toBeTruthy();
  });

  it('describes the service with the ACS address and the signing certificate', () => {
    const { client } = setup();
    const xml = client.serviceMetadata();
    expect(xml).toContain(`entityID="${ENTITY}"`);
    expect(xml).toMatch(
      /AssertionConsumerService[^>]*Location="https:\/\/aip\.example\.com\/auth\/saml\/acs"/,
    );
    expect(xml).toContain('HTTP-POST');
    expect(xml).toContain(service.certificateBody);
  });
});

describe('metadata of the provider', () => {
  it('reads the entityID, the redirect address and the signing certificate', () => {
    const parsed = parseIdpMetadata(idp.metadata());
    expect(parsed.entityId).toBe(idp.entityId);
    expect(parsed.ssoUrl).toBe(idp.ssoUrl);
    expect(parsed.certificates).toHaveLength(1);
    expect(parsed.certificates[0]).toContain('BEGIN CERTIFICATE');
  });

  it('refuses metadata without a redirect service or a certificate', () => {
    expect(() => parseIdpMetadata('<a/>')).toThrow(/no identity provider/);
    const noRedirect = idp.metadata().replace('HTTP-Redirect', 'HTTP-Artifact');
    expect(() => parseIdpMetadata(noRedirect)).toThrow(/HTTP-Redirect/);
  });

  function remote(now: { value: number }, fetched: { count: number; down: boolean }) {
    const directory = mkdtempSync(join(tmpdir(), 'aip-saml-copy-'));
    const copyPath = join(directory, 'saml', 'idp.xml');
    const warnings: string[] = [];
    const source = new IdpMetadataSource({
      location: 'https://idp.corp.com/metadata.xml',
      copyPath,
      now: () => now.value,
      warn: (message) => warnings.push(message),
      fetch: (async () => {
        fetched.count += 1;
        if (fetched.down) return new Response('down', { status: 503 });
        return new Response(idp.metadata());
      }) as typeof fetch,
    });
    return { source, copyPath, warnings };
  }

  it('downloads the metadata, keeps a copy and refreshes once a day', async () => {
    const now = { value: 1_000 };
    const fetched = { count: 0, down: false };
    const { source, copyPath } = remote(now, fetched);
    expect((await source.get()).entityId).toBe(idp.entityId);
    expect(source.status()).toBe('ready');
    expect(readFileSync(copyPath, 'utf8')).toBe(idp.metadata());
    await source.get();
    expect(fetched.count).toBe(1);
    now.value += METADATA_REFRESH_MS;
    await source.get();
    await source.load();
    expect(fetched.count).toBe(2);
  });

  it('starts from the last good copy while the provider is down', async () => {
    const now = { value: 1_000 };
    const fetched = { count: 0, down: false };
    const first = remote(now, fetched);
    await first.source.get();
    fetched.down = true;
    const again = new IdpMetadataSource({
      location: 'https://idp.corp.com/metadata.xml',
      copyPath: first.copyPath,
      now: () => now.value,
      warn: (message) => first.warnings.push(message),
      fetch: (async () => new Response('down', { status: 503 })) as typeof fetch,
    });
    expect((await again.get()).entityId).toBe(idp.entityId);
    expect(first.warnings.join('\n')).toContain('last good copy');
  });

  it('is unavailable without a download and without a copy', async () => {
    const now = { value: 1_000 };
    const { source } = remote(now, { count: 0, down: true });
    await expect(source.get()).rejects.toMatchObject({ code: 'identity.saml_unavailable' });
    expect(source.status()).toBe('unavailable');
  });
});
