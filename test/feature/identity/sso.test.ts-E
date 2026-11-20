import { describe, expect, it } from 'vitest';

import type {
  OidcIdentity,
  OidcProvider,
  OidcRequestSecrets,
} from '../../../src/feature/identity/ports/index.ts';
import { createIdentityServices } from '../../../src/feature/identity/services/index.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';
import {
  type ServerSettings,
  defaultServer,
  defaultWeb,
} from '../../../src/feature/swarm-config/types/index.ts';
import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';

const ISSUER = 'https://sso.example.com';

class FakeProvider implements OidcProvider {
  identity: OidcIdentity = { issuer: ISSUER, subject: '42', claims: {} };
  last: OidcRequestSecrets | null = null;
  fail = false;
  state: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  status() {
    return this.state;
  }

  async check(): Promise<void> {}

  async authorizationUrl(request: OidcRequestSecrets): Promise<string> {
    this.last = request;
    return `${ISSUER}/authorize?state=${request.state}`;
  }

  async complete(): Promise<OidcIdentity> {
    if (this.fail) throw new Error('bad id token');
    return this.identity;
  }
}

function settings(oidc: Record<string, unknown> = {}): ServerSettings {
  const { server, errors } = validateServerSection(
    {
      enabled: true,
      public_url: 'https://aip.example.com',
      sso: {
        oidc: { issuer: ISSUER, client_id: 'aip', client_secret_env: 'S', ...oidc },
      },
    },
    defaultWeb(),
  );
  expect(errors).toEqual([]);
  return server;
}

function setup(
  server: ServerSettings = settings(),
  provider: FakeProvider | null = new FakeProvider(),
) {
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
    oidc: () => provider,
  });
  const signIn = async (identity: OidcIdentity, returnTo = '/runs') => {
    if (provider) provider.identity = identity;
    const { url } = await services.sso.begin({ returnTo });
    const state = new URL(url).searchParams.get('state')!;
    return services.sso.complete({ query: `code=c&state=${state}` });
  };
  return { services, provider, signIn, advance: (ms: number) => (time += ms) };
}

const alice = (claims: Record<string, unknown> = {}): OidcIdentity => ({
  issuer: ISSUER,
  subject: '42',
  claims: { email: 'a@corp.com', name: 'Alice', email_verified: true, ...claims },
});

describe('sign-in through OIDC', () => {
  it('creates a user at the first sign-in and returns to the page it started from', async () => {
    const { services, signIn } = setup(
      settings({ attributes: { groups: 'groups', department: 'dept' } }),
    );
    const result = await signIn(alice({ groups: ['dev', 'ops'], dept: 'platform' }));
    expect(result.returnTo).toBe('/runs');
    expect(result.user).toMatchObject({
      email: 'a@corp.com',
      name: 'Alice',
      source: 'oidc',
      subject: { issuer: ISSUER, subject: '42' },
      attributes: { groups: ['dev', 'ops'], department: ['platform'] },
    });
    expect(services.sessions.resolve(result.session)?.email).toBe('a@corp.com');
  });

  it('finds the user by issuer and subject after the email changed and replaces attributes', async () => {
    const { services, signIn } = setup(settings({ attributes: { groups: 'groups' } }));
    const first = await signIn(alice({ groups: ['dev'] }));
    const second = await signIn(alice({ email: 'alice@corp.com', groups: ['ops'] }));
    expect(second.user.id).toBe(first.user.id);
    expect(services.users.list()).toHaveLength(1);
    expect(services.users.byId(first.user.id)).toMatchObject({
      email: 'alice@corp.com',
      attributes: { groups: ['ops'] },
    });
  });

  it('links a local user only when the provider verified the email', async () => {
    const { services, signIn } = setup();
    const local = services.users.ensure('admin@corp.com', null, true);
    await expect(
      signIn(alice({ email: 'Admin@corp.com', email_verified: false })),
    ).rejects.toMatchObject({ code: 'identity.sso_unverified' });
    expect(services.users.byId(local.id)).toMatchObject({ source: 'local', subject: null });
    const linked = await signIn(alice({ email: 'Admin@corp.com' }));
    expect(linked.user.id).toBe(local.id);
    expect(services.users.byId(local.id)).toMatchObject({
      source: 'oidc',
      subject: { issuer: ISSUER, subject: '42' },
    });
  });

  it('refuses a domain outside allowed_domains and creates nobody', async () => {
    const { services, signIn } = setup(settings({ allowed_domains: ['corp.com'] }));
    await expect(signIn(alice({ email: 'eve@gmail.com' }))).rejects.toMatchObject({
      code: 'identity.sso_domain',
    });
    expect(services.users.list()).toEqual([]);
    await expect(signIn(alice({ email: 'bob@corp.com' }))).resolves.toBeTruthy();
  });

  it('refuses a disabled user', async () => {
    const { services, signIn } = setup();
    await signIn(alice());
    services.users.disable('a@corp.com');
    await expect(signIn(alice())).rejects.toMatchObject({ code: 'identity.user_disabled' });
  });

  it('refuses a user without an email', async () => {
    const { signIn } = setup();
    await expect(signIn({ issuer: ISSUER, subject: '7', claims: {} })).rejects.toMatchObject({
      code: 'identity.sso_email',
    });
  });

  it('reads the email and the name from the configured claims', async () => {
    const { signIn } = setup(settings({ claims: { email: 'mail', name: 'display' } }));
    const result = await signIn({
      issuer: ISSUER,
      subject: '9',
      claims: { mail: 'm@corp.com', display: 'Mia' },
    });
    expect(result.user).toMatchObject({ email: 'm@corp.com', name: 'Mia' });
  });

  it('accepts an unknown, repeated or expired state nowhere', async () => {
    const { services, advance, provider } = setup();
    provider!.identity = alice();
    await expect(services.sso.complete({ query: 'code=c&state=nope' })).rejects.toMatchObject({
      code: 'identity.sso_state',
    });
    const { url } = await services.sso.begin({});
    const state = new URL(url).searchParams.get('state')!;
    await services.sso.complete({ query: `code=c&state=${state}` });
    await expect(services.sso.complete({ query: `code=c&state=${state}` })).rejects.toMatchObject({
      code: 'identity.sso_state',
    });
    const again = new URL((await services.sso.begin({})).url).searchParams.get('state')!;
    advance(11 * 60_000);
    await expect(services.sso.complete({ query: `code=c&state=${again}` })).rejects.toMatchObject({
      code: 'identity.sso_state',
    });
  });

  it('passes the failure of the provider checks and creates no session', async () => {
    const { services, provider } = setup();
    provider!.fail = true;
    const { url } = await services.sso.begin({});
    const state = new URL(url).searchParams.get('state')!;
    await expect(services.sso.complete({ query: `code=c&state=${state}` })).rejects.toThrow(
      /bad id token/,
    );
    expect(services.users.list()).toEqual([]);
  });

  it('reports the unavailable provider in the info', () => {
    const { services, provider } = setup();
    provider!.state = 'unavailable';
    expect(services.sso.info()).toEqual({ label: 'SSO', ready: true, unavailable: true });
  });

  it('reports an error of the provider in the query', async () => {
    const { services } = setup();
    const state = new URL((await services.sso.begin({})).url).searchParams.get('state')!;
    await expect(
      services.sso.complete({ query: `error=access_denied&error_description=no&state=${state}` }),
    ).rejects.toMatchObject({ code: 'identity.sso_refused' });
  });

  it('keeps only addresses of the panel as the return page', async () => {
    const { services, provider } = setup();
    for (const bad of ['https://evil.example', '//evil.example', 'runs']) {
      const state = new URL((await services.sso.begin({ returnTo: bad })).url).searchParams.get(
        'state',
      )!;
      provider!.identity = alice();
      const result = await services.sso.complete({ query: `code=c&state=${state}` });
      expect(result.returnTo).toBe('/');
    }
  });

  it('uses the redirect address of the public url with PKCE secrets', async () => {
    const { services, provider } = setup();
    await services.sso.begin({});
    expect(provider!.last).toMatchObject({
      redirectUri: 'https://aip.example.com/auth/oidc/callback',
    });
    expect(provider!.last!.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('is unavailable without a provider or a configuration', async () => {
    const without = setup(settings(), null);
    expect(without.services.sso.info()).toEqual({ label: 'SSO', ready: false, unavailable: false });
    await expect(without.services.sso.begin({})).rejects.toMatchObject({
      kind: 'unavailable',
    });
    const unset = setup(defaultServer());
    expect(unset.services.sso.info()).toBeNull();
  });

  it('forbids attributes of an oidc user to be set by hand', async () => {
    const { services, signIn } = setup();
    await signIn(alice());
    expect(() => services.users.setAttributes('a@corp.com', { role: ['admin'] })).toThrow(
      /come from the provider/,
    );
  });
});
