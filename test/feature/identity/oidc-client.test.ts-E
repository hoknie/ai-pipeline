import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OidcClient } from '../../../src/feature/identity/clients/oidc/index.ts';
import type { OidcRequestSecrets } from '../../../src/feature/identity/ports/index.ts';
import { defaultServer, type OidcSettings } from '../../../src/feature/swarm-config/types/index.ts';
import { validateServerSection } from '../../../src/feature/swarm-config/services/sections/server.ts';
import { defaultWeb } from '../../../src/feature/swarm-config/types/index.ts';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeOidcProvider } from '../../fakes/oidc-provider.ts';

const provider = new FakeOidcProvider();
beforeAll(async () => {
  await provider.start();
});
afterAll(async () => {
  await provider.stop();
});

function settings(): OidcSettings {
  const { server } = validateServerSection(
    {
      sso: {
        oidc: { issuer: provider.issuer, client_id: FAKE_CLIENT_ID, client_secret_env: 'X' },
      },
    },
    defaultWeb(),
  );
  return (server.sso.oidc ?? defaultServer().sso.oidc) as OidcSettings;
}

const secrets: OidcRequestSecrets = {
  redirectUri: 'https://aip.example.com/auth/oidc/callback',
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'v'.repeat(43),
};

function adapter(warnings: string[] = []): OidcClient {
  return new OidcClient({
    settings: settings(),
    clientSecret: FAKE_CLIENT_SECRET,
    warn: (message) => warnings.push(message),
  });
}

describe('OIDC client against a fake provider', () => {
  it('builds an authorization address with PKCE, state and nonce', async () => {
    const url = new URL(await adapter().authorizationUrl(secrets));
    expect(url.origin + url.pathname).toBe(`${provider.issuer}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: FAKE_CLIENT_ID,
      redirect_uri: secrets.redirectUri,
      scope: 'openid email profile',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('exchanges the code and returns the identity', async () => {
    const client = adapter();
    const back = provider.authorize(await client.authorizationUrl(secrets), {
      sub: '42',
      email: 'a@corp.com',
      groups: ['dev'],
    });
    const identity = await client.complete({ ...secrets, callbackUrl: back });
    expect(identity.issuer).toBe(provider.issuer);
    expect(identity.subject).toBe('42');
    expect(identity.claims).toMatchObject({ email: 'a@corp.com', groups: ['dev'] });
  });

  async function attempt(
    override: Record<string, unknown> = {},
    options: { badSignature?: boolean; state?: string } = {},
  ): Promise<unknown> {
    const client = adapter();
    const back = new URL(
      provider.authorize(
        await client.authorizationUrl(secrets),
        { sub: '1' },
        { override, badSignature: options.badSignature },
      ),
    );
    if (options.state) back.searchParams.set('state', options.state);
    return client.complete({ ...secrets, callbackUrl: back.href });
  }

  it('rejects a wrong state, nonce, audience, issuer and signature', async () => {
    await expect(attempt({}, { state: 'other' })).rejects.toThrow(/sign-in failed/);
    await expect(attempt({ nonce: 'other' })).rejects.toThrow(/sign-in failed/);
    await expect(attempt({ aud: 'someone-else' })).rejects.toThrow(/sign-in failed/);
    await expect(attempt({ iss: 'http://evil.example' })).rejects.toThrow(/sign-in failed/);
    await expect(attempt({}, { badSignature: true })).rejects.toThrow(/sign-in failed/);
  });

  it('allows 60 seconds of clock drift and no more', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(attempt({ exp: now - 30 })).resolves.toMatchObject({ subject: '1' });
    await expect(attempt({ exp: now - 120 })).rejects.toThrow(/sign-in failed/);
  });

  it('does not reuse a code', async () => {
    const client = adapter();
    const back = provider.authorize(await client.authorizationUrl(secrets), { sub: '1' });
    await client.complete({ ...secrets, callbackUrl: back });
    await expect(client.complete({ ...secrets, callbackUrl: back })).rejects.toThrow(/sign-in/);
  });

  it('repeats the discovery after a failure and logs the reason', async () => {
    const warnings: string[] = [];
    const client = adapter(warnings);
    provider.down = true;
    await expect(client.authorizationUrl(secrets)).rejects.toMatchObject({
      code: 'identity.oidc_unavailable',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(provider.issuer);
    provider.down = false;
    await expect(client.authorizationUrl(secrets)).resolves.toContain('/authorize');
  });
});
