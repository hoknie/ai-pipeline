import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';
import { defaultWeb } from '../../../src/feature/swarm-config/types/index.ts';

const web = defaultWeb();

function files() {
  const root = mkdtempSync(join(tmpdir(), 'aip-saml-config-'));
  mkdirSync(root, { recursive: true });
  const key = join(root, 'saml.key');
  const cert = join(root, 'saml.crt');
  const metadata = join(root, 'idp.xml');
  for (const path of [key, cert, metadata]) writeFileSync(path, 'content');
  return { root, key, cert, metadata };
}

function section(saml: unknown) {
  return validateServerSection({ sso: { saml } }, web);
}

describe('server.sso.saml', () => {
  it('accepts a provider with files that can be read and fills defaults', () => {
    const f = files();
    const { server, errors } = section({
      idp_metadata: f.metadata,
      key_file: f.key,
      cert_file: f.cert,
    });
    expect(errors).toEqual([]);
    expect(server.sso.saml).toEqual({
      idpMetadata: f.metadata,
      entityId: null,
      keyFile: f.key,
      certFile: f.cert,
      label: 'SAML',
      claims: { email: null, name: null },
      attributes: {},
      trustEmail: false,
      allowedDomains: [],
    });
  });

  it('accepts a metadata URL and reads the optional fields', () => {
    const f = files();
    const { server, errors } = section({
      idp_metadata: 'https://adfs.corp.com/FederationMetadata/2007-06/FederationMetadata.xml',
      entity_id: 'https://aip.example.com/saml',
      key_file: f.key,
      cert_file: f.cert,
      label: 'ADFS',
      claims: { email: 'mail', name: 'cn' },
      attributes: { groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups' },
      trust_email: true,
      allowed_domains: ['Corp.com'],
    });
    expect(errors).toEqual([]);
    expect(server.sso.saml).toMatchObject({
      entityId: 'https://aip.example.com/saml',
      label: 'ADFS',
      claims: { email: 'mail', name: 'cn' },
      trustEmail: true,
      allowedDomains: ['corp.com'],
    });
  });

  it('names key_file when the file is missing', () => {
    const f = files();
    const { errors } = section({
      idp_metadata: f.metadata,
      key_file: join(f.root, 'absent.key'),
      cert_file: f.cert,
    });
    expect(errors.map((e) => e.path)).toEqual(['swarm.server.sso.saml.key_file']);
    expect(errors[0]?.message).toContain('does not exist');
  });

  it('names a missing metadata file and a missing certificate', () => {
    const f = files();
    const { errors } = section({
      idp_metadata: join(f.root, 'absent.xml'),
      key_file: f.key,
      cert_file: join(f.root, 'absent.crt'),
    });
    expect(errors.map((e) => e.path)).toEqual([
      'swarm.server.sso.saml.idp_metadata',
      'swarm.server.sso.saml.cert_file',
    ]);
  });

  it('requires the metadata, the key and the certificate', () => {
    expect(section({}).errors.map((e) => e.path)).toEqual([
      'swarm.server.sso.saml.idp_metadata',
      'swarm.server.sso.saml.key_file',
      'swarm.server.sso.saml.cert_file',
    ]);
  });

  it('does not take the key inline', () => {
    const f = files();
    const { errors } = section({
      idp_metadata: f.metadata,
      key_file: f.key,
      cert_file: f.cert,
      private_key: '-----BEGIN PRIVATE KEY-----',
    });
    expect(errors.map((e) => e.path)).toEqual(['swarm.server.sso.saml.private_key']);
  });

  it('rejects wrong types and domains', () => {
    const f = files();
    const base = { idp_metadata: f.metadata, key_file: f.key, cert_file: f.cert };
    const paths = (extra: Record<string, unknown>) =>
      section({ ...base, ...extra }).errors.map((e) => e.path);
    expect(paths({ trust_email: 'yes' })).toEqual(['swarm.server.sso.saml.trust_email']);
    expect(paths({ allowed_domains: ['corp.com', 'x'] })).toEqual([
      'swarm.server.sso.saml.allowed_domains[1]',
    ]);
    expect(paths({ claims: { phone: 'p' } })).toEqual(['swarm.server.sso.saml.claims.phone']);
  });

  it('keeps the unknown provider error', () => {
    expect(validateServerSection({ sso: { ldap: {} } }, web).errors.map((e) => e.path)).toEqual([
      'swarm.server.sso.ldap',
    ]);
  });
});
