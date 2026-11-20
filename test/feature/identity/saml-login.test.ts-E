import { describe, expect, it } from 'vitest';

import type {
  SamlIdentity,
  SamlProvider,
  SamlRequestIds,
} from '../../../src/feature/identity/ports/index.ts';
import { createIdentityServices } from '../../../src/feature/identity/services/index.ts';
import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';
import {
  type ServerSettings,
  defaultServer,
  defaultWeb,
} from '../../../src/feature/swarm-config/types/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ISSUER = 'https://idp.corp.com/adfs/services/trust';
const GROUPS = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups';

class FakeSaml implements SamlProvider {
  identity: SamlIdentity = {
    issuer: ISSUER,
    nameId: 'alice-1',
    nameIdFormat: null,
    attributes: {},
  };
  last: SamlRequestIds | null = null;
  answeredTo: string | null = null;
  fail = false;
  state: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  status() {
    return this.state;
  }

  async check(): Promise<void> {}

  async authorizeUrl(request: SamlRequestIds): Promise<string> {
    this.last = request;
    return `${ISSUER}/ls?RelayState=${request.relayState}`;
  }

  async validatePostResponse(response: { requestId: string }): Promise<SamlIdentity> {
    this.answeredTo = response.requestId;
    if (this.fail) throw new Error('Invalid signature');
    return this.identity;
  }

  serviceMetadata(): string {
    return '<EntityDescriptor/>';
  }
}

function settings(saml: Record<string, unknown> = {}): ServerSettings {
  const directory = mkdtempSync(join(tmpdir(), 'aip-saml-login-'));
  const files = ['idp.xml', 'saml.key', 'saml.crt'].map((name) => {
    const path = join(directory, name);
    writeFileSync(path, 'x');
    return path;
  });
  const { server, errors } = validateServerSection(
    {
      enabled: true,
      public_url: 'https://aip.example.com',
      sso: {
        saml: { idp_metadata: files[0], key_file: files[1], cert_file: files[2], ...saml },
      },
    },
    defaultWeb(),
  );
  expect(errors).toEqual([]);
  return server;
}

function setup(server: ServerSettings = settings(), provider: FakeSaml | null = new FakeSaml()) {
  let time = 1_000_000;
  let counter = 0;
  const services = createIdentityServices({
    database: new Database(':memory:'),
    settings: () => server,
    clock: { now: () => time },
    random: {
      token: (size) => `t${(counter += 1)}`.padEnd(Math.ceil((size * 4) / 3), 'x'),
      id: () => `id-${(counter += 1)}`,
    },
    saml: () => provider,
  });
  const signIn = async (identity: Partial<SamlIdentity>, returnTo = '/runs') => {
    if (provider) provider.identity = { ...provider.identity, ...identity };
    const { url } = await services.saml.begin({ returnTo });
    const relayState = new URL(url).searchParams.get('RelayState')!;
    return services.saml.complete({ samlResponse: 'PHJlc3BvbnNlLz4=', relayState });
  };
  return { services, provider, signIn, advance: (ms: number) => (time += ms) };
}

const alice = (attributes: Record<string, unknown> = {}): Partial<SamlIdentity> => ({
  nameId: 'alice-1',
  attributes: { mail: 'alice@corp.com', cn: 'Alice', ...attributes },
});

describe('sign-in through SAML', () => {
  it('creates a user keyed by the entityID and the NameID and maps the groups', async () => {
    const { services, signIn } = setup(
      settings({ claims: { email: 'mail', name: 'cn' }, attributes: { groups: GROUPS } }),
    );
    const result = await signIn(alice({ [GROUPS]: ['dev', 'ops'] }));
    expect(result.returnTo).toBe('/runs');
    expect(result.user).toMatchObject({
      email: 'alice@corp.com',
      name: 'Alice',
      source: 'saml',
      subject: { issuer: ISSUER, subject: 'alice-1' },
      attributes: { groups: ['dev', 'ops'] },
    });
    expect(services.sessions.resolve(result.session)?.email).toBe('alice@corp.com');
  });

  it('takes the NameID as the email by default', async () => {
    const { signIn } = setup();
    const result = await signIn({ nameId: 'bob@corp.com', attributes: {} });
    expect(result.user).toMatchObject({ email: 'bob@corp.com', name: 'bob' });
  });

  it('finds the user by the NameID after the email changed and replaces the attributes', async () => {
    const { services, signIn } = setup(
      settings({ claims: { email: 'mail' }, attributes: { groups: GROUPS } }),
    );
    const first = await signIn(alice({ [GROUPS]: ['dev'] }));
    const second = await signIn(alice({ mail: 'a2@corp.com', [GROUPS]: 'ops' }));
    expect(second.user.id).toBe(first.user.id);
    expect(services.users.list()).toHaveLength(1);
    expect(services.users.byId(first.user.id)).toMatchObject({
      email: 'a2@corp.com',
      attributes: { groups: ['ops'] },
    });
  });

  it('keeps users of one NameID at two providers apart', async () => {
    const { services, signIn } = setup(settings({ claims: { email: 'mail' } }));
    const first = await signIn(alice());
    const second = await signIn({
      issuer: 'https://other.corp.com',
      nameId: 'alice-1',
      attributes: { mail: 'other@corp.com' },
    });
    expect(second.user.id).not.toBe(first.user.id);
    expect(services.users.list()).toHaveLength(2);
  });

  it('refuses an existing local email without trust_email and leaves the account alone', async () => {
    const { services, signIn } = setup(settings({ claims: { email: 'mail' } }));
    const local = services.users.ensure('admin@corp.com', null, true);
    await expect(signIn(alice({ mail: 'Admin@corp.com' }))).rejects.toMatchObject({
      code: 'identity.sso_unverified',
    });
    expect(services.users.byId(local.id)).toMatchObject({ source: 'local', subject: null });
  });

  it('links the local user with trust_email', async () => {
    const { services, signIn } = setup(settings({ claims: { email: 'mail' }, trust_email: true }));
    const local = services.users.ensure('admin@corp.com', null, true);
    const linked = await signIn(alice({ mail: 'Admin@corp.com' }));
    expect(linked.user.id).toBe(local.id);
    expect(services.users.byId(local.id)).toMatchObject({
      source: 'saml',
      subject: { issuer: ISSUER, subject: 'alice-1' },
    });
  });

  it('refuses a domain outside allowed_domains and creates nobody', async () => {
    const { services, signIn } = setup(
      settings({ claims: { email: 'mail' }, allowed_domains: ['corp.com'] }),
    );
    await expect(signIn(alice({ mail: 'eve@gmail.com' }))).rejects.toMatchObject({
      code: 'identity.sso_domain',
    });
    expect(services.users.list()).toEqual([]);
    await expect(
      signIn({ nameId: 'bob', attributes: { mail: 'bob@corp.com' } }),
    ).resolves.toBeTruthy();
  });

  it('refuses a disabled user and a user without an email', async () => {
    const { services, signIn } = setup(settings({ claims: { email: 'mail' } }));
    await signIn(alice());
    services.users.disable('alice@corp.com');
    await expect(signIn(alice())).rejects.toMatchObject({ code: 'identity.user_disabled' });
    await expect(signIn({ nameId: 'x', attributes: {} })).rejects.toMatchObject({
      code: 'identity.sso_email',
    });
  });

  it('forbids setting the attributes of a saml user by hand', async () => {
    const { services, signIn } = setup(settings({ claims: { email: 'mail' } }));
    await signIn(alice());
    expect(() => services.users.setAttributes('alice@corp.com', { role: ['admin'] })).toThrow(
      /come from the provider/,
    );
  });
});

describe('the request of a SAML sign-in', () => {
  it('stores the request under the RelayState and gives the response its ID', async () => {
    const { services, provider } = setup();
    await services.saml.begin({});
    const request = provider!.last!;
    expect(request.requestId).toBe(`_${request.relayState}`);
    provider!.identity = {
      ...provider!.identity,
      attributes: { mail: 'a@corp.com' },
      nameId: 'a@corp.com',
    };
    await services.saml.complete({ samlResponse: 'x', relayState: request.relayState });
    expect(provider!.answeredTo).toBe(request.requestId);
  });

  it('accepts an unknown, repeated or expired RelayState nowhere', async () => {
    const { services, advance, provider } = setup();
    provider!.identity = { ...provider!.identity, nameId: 'a@corp.com' };
    await expect(
      services.saml.complete({ samlResponse: 'x', relayState: 'nope' }),
    ).rejects.toMatchObject({ code: 'identity.sso_state' });
    await expect(
      services.saml.complete({ samlResponse: 'x', relayState: '' }),
    ).rejects.toMatchObject({ code: 'identity.sso_state' });
    await services.saml.begin({});
    const state = provider!.last!.relayState;
    await services.saml.complete({ samlResponse: 'x', relayState: state });
    await expect(
      services.saml.complete({ samlResponse: 'x', relayState: state }),
    ).rejects.toMatchObject({ code: 'identity.sso_state' });
    await services.saml.begin({});
    const late = provider!.last!.relayState;
    advance(11 * 60_000);
    await expect(
      services.saml.complete({ samlResponse: 'x', relayState: late }),
    ).rejects.toMatchObject({ code: 'identity.sso_state' });
  });

  it('does not mix the requests of the two protocols', async () => {
    const server = settings();
    server.sso.oidc = {
      issuer: 'https://sso.example.com',
      clientId: 'aip',
      clientSecretEnv: 'S',
      scopes: ['openid'],
      label: 'SSO',
      claims: { email: 'email', name: 'name' },
      attributes: {},
      allowedDomains: [],
    };
    const provider = new FakeSaml();
    const services = createIdentityServices({
      database: new Database(':memory:'),
      settings: () => server,
      saml: () => provider,
      oidc: () => ({
        status: () => 'ready',
        check: async () => {},
        authorizationUrl: async () => '',
        complete: async () => ({ issuer: 'https://sso.example.com', subject: '1', claims: {} }),
      }),
    });
    await services.saml.begin({});
    await expect(
      services.sso.complete({ query: `code=c&state=${provider.last!.relayState}` }),
    ).rejects.toMatchObject({ code: 'identity.sso_state' });
  });

  it('passes the failure of the checks and creates no user or session', async () => {
    const { services, provider } = setup();
    provider!.fail = true;
    await services.saml.begin({});
    await expect(
      services.saml.complete({ samlResponse: 'x', relayState: provider!.last!.relayState }),
    ).rejects.toThrow(/Invalid signature/);
    expect(services.users.list()).toEqual([]);
  });

  it('keeps only addresses of the panel as the return page', async () => {
    const { services, provider } = setup();
    provider!.identity = { ...provider!.identity, nameId: 'a@corp.com' };
    for (const bad of ['https://evil.example', '//evil.example', 'runs']) {
      await services.saml.begin({ returnTo: bad });
      const result = await services.saml.complete({
        samlResponse: 'x',
        relayState: provider!.last!.relayState,
      });
      expect(result.returnTo).toBe('/');
    }
  });

  it('reports the info and the metadata, and is unavailable without a provider', async () => {
    const { services, provider } = setup(settings({ label: 'ADFS' }));
    expect(services.saml.info()).toEqual({ label: 'ADFS', ready: true, unavailable: false });
    provider!.state = 'unavailable';
    expect(services.saml.info()).toEqual({ label: 'ADFS', ready: true, unavailable: true });
    expect(services.saml.metadata()).toEqual({ xml: '<EntityDescriptor/>' });
    const without = setup(settings(), null);
    expect(without.services.saml.info()).toEqual({
      label: 'SAML',
      ready: false,
      unavailable: false,
    });
    await expect(without.services.saml.begin({})).rejects.toMatchObject({ kind: 'unavailable' });
    expect(() => without.services.saml.metadata()).toThrow(/not configured/);
    expect(setup(defaultServer()).services.saml.info()).toBeNull();
  });
});
