import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeOidcProvider } from '../fakes/oidc-provider.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;
let provider: FakeOidcProvider | null = null;
const logs: string[] = [];

afterEach(async () => {
  await current?.close();
  current = null;
  await provider?.stop();
  provider = null;
});

async function start(environment: NodeJS.ProcessEnv): Promise<Harness> {
  provider = await new FakeOidcProvider().start();
  logs.length = 0;
  current = await harness(undefined, environment, { log: (message) => logs.push(message) });
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server:
  enabled: true
  public_url: "https://aip.example.com"
  sso:
    oidc:
      issuer: "${provider.issuer}"
      client_id: ${FAKE_CLIENT_ID}
      client_secret_env: AIP_OIDC_SECRET
`,
  );
  return current;
}

const call = (h: Harness, method: string, params: unknown) =>
  request(h.socket, method as 'status', params as never);

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    return error as IpcError;
  }
  throw new Error('expected a rejection');
}

describe('OIDC methods of the daemon', () => {
  it('begins a sign-in and completes it with the query of the provider', async () => {
    const h = await start({ AIP_OIDC_SECRET: FAKE_CLIENT_SECRET });
    expect(await call(h, 'auth_oidc_info', {})).toEqual({
      sso: { label: 'SSO', ready: true, unavailable: false },
    });
    const { url } = (await call(h, 'auth_oidc_begin', { returnTo: '/queue' })) as { url: string };
    expect(url.startsWith(`${provider!.issuer}/authorize?`)).toBe(true);
    const back = new URL(
      provider!.authorize(url, { sub: '1', email: 'a@corp.com', name: 'A', email_verified: true }),
    );
    const done = (await call(h, 'auth_oidc_complete', { query: back.search.slice(1) })) as {
      session: string;
      returnTo: string;
      user: { email: string; source: string };
    };
    expect(done.returnTo).toBe('/queue');
    expect(done.user).toMatchObject({ email: 'a@corp.com', source: 'oidc' });
    const resolved = (await call(h, 'auth_resolve', { session: done.session })) as {
      user: { email: string } | null;
    };
    expect(resolved.user?.email).toBe('a@corp.com');
    const again = await rejection(call(h, 'auth_oidc_complete', { query: back.search.slice(1) }));
    expect(again.message).toMatch(/unknown or has expired/);
  });

  it('refuses users_set for a user of the provider', async () => {
    const h = await start({ AIP_OIDC_SECRET: FAKE_CLIENT_SECRET });
    const { url } = (await call(h, 'auth_oidc_begin', {})) as { url: string };
    const back = new URL(
      provider!.authorize(url, { sub: '1', email: 'a@corp.com', email_verified: true }),
    );
    await call(h, 'auth_oidc_complete', { query: back.search.slice(1) });
    const error = await rejection(
      call(h, 'users_set', { email: 'a@corp.com', attributes: { role: ['admin'] } }),
    );
    expect(error.message).toMatch(/come from the provider/);
  });

  it('keeps running without the client secret, names the variable and refuses SSO', async () => {
    const h = await start({ AIP_OIDC_SECRET: '' });
    expect(await call(h, 'auth_oidc_info', {})).toEqual({
      sso: { label: 'SSO', ready: false, unavailable: false },
    });
    expect(logs.filter((line) => line.includes('AIP_OIDC_SECRET'))).toHaveLength(1);
    const error = await rejection(call(h, 'auth_oidc_begin', {}));
    expect(error.remoteCode).toBe('identity.oidc_not_configured');
    expect(await call(h, 'status', {})).toBeDefined();
    const link = (await call(h, 'login_link_create', { email: 'a@corp.com' })) as { url: string };
    expect(link.url).toContain('/auth/link/');
  });

  it('logs the reason when the provider is down and tries again at the next sign-in', async () => {
    const h = await start({ AIP_OIDC_SECRET: FAKE_CLIENT_SECRET });
    provider!.down = true;
    const error = await rejection(call(h, 'auth_oidc_begin', {}));
    expect(error.remoteCode).toBe('identity.oidc_unavailable');
    expect(logs.some((line) => line.includes(provider!.issuer))).toBe(true);
    provider!.down = false;
    await expect(call(h, 'auth_oidc_begin', {})).resolves.toMatchObject({
      url: expect.any(String),
    });
    expect(provider!.discoveryHits).toBe(2);
  });
});
