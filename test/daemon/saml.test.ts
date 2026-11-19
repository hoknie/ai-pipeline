import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import { FakeKeyPair, FakeSamlIdp, redirectParts, writeSamlFiles } from '../fakes/saml-provider.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const PUBLIC_URL = 'https://aip.example.com';
const ACS = `${PUBLIC_URL}/auth/saml/acs`;
const ENTITY = `${PUBLIC_URL}/auth/saml/metadata`;
const idp = new FakeSamlIdp();
const service = new FakeKeyPair('aip');
const logs: string[] = [];

async function start(extra = ''): Promise<Harness> {
  logs.length = 0;
  current = await harness(undefined, {}, { log: (message) => logs.push(message) });
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  const saml = writeSamlFiles(join(directory, 'saml'), idp, service, extra);
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server:
  enabled: true
  public_url: "${PUBLIC_URL}"
  sso:
${saml}`,
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

/** Begins a sign-in and answers it as the provider would. */
async function begin(h: Harness, returnTo = '/queue') {
  const { url } = (await call(h, 'auth_saml_begin', { returnTo })) as { url: string };
  const { relayState, requestXml } = redirectParts(url);
  const requestId = /ID="([^"]+)"/.exec(requestXml)![1]!;
  return { url, relayState, requestId };
}

const answer = (requestId: string, options: Partial<Parameters<FakeSamlIdp['response']>[0]> = {}) =>
  idp.response({
    requestId,
    acsUrl: ACS,
    audience: ENTITY,
    attributes: { mail: 'alice@corp.com' },
    ...options,
  });

describe('SAML methods of the daemon', () => {
  it('reports the provider, begins a sign-in and completes it with the signed response', async () => {
    const h = await start('      label: ADFS\n      claims: { email: mail }\n');
    expect(await call(h, 'auth_oidc_info', {})).toEqual({
      sso: null,
      saml: { label: 'ADFS', ready: true, unavailable: false },
    });
    const { url, relayState, requestId } = await begin(h);
    expect(url.startsWith(idp.ssoUrl)).toBe(true);
    const done = (await call(h, 'auth_saml_complete', {
      samlResponse: answer(requestId),
      relayState,
    })) as { session: string; returnTo: string; user: { email: string; source: string } };
    expect(done.returnTo).toBe('/queue');
    expect(done.user).toMatchObject({ email: 'alice@corp.com', source: 'saml' });
    const resolved = (await call(h, 'auth_resolve', { session: done.session })) as {
      user: { email: string } | null;
    };
    expect(resolved.user?.email).toBe('alice@corp.com');
  });

  it('accepts an assertion once: the second post is refused and no second session exists', async () => {
    const h = await start('      claims: { email: mail }\n');
    const first = await begin(h);
    const response = answer(first.requestId, { assertionId: '_replayed' });
    await call(h, 'auth_saml_complete', { samlResponse: response, relayState: first.relayState });
    const again = await rejection(
      call(h, 'auth_saml_complete', { samlResponse: response, relayState: first.relayState }),
    );
    expect(again.remoteCode).toBe('identity.sso_state');
    // the same assertion under a fresh request is refused as a replay, too
    const second = await begin(h);
    const replay = await rejection(
      call(h, 'auth_saml_complete', {
        samlResponse: answer(second.requestId, { assertionId: '_replayed' }),
        relayState: second.relayState,
      }),
    );
    expect(replay.message).toMatch(/already been received/);
    const users = (await call(h, 'users_list', {})) as { users: unknown[] };
    expect(users.users).toHaveLength(1);
  });

  it('refuses an unsigned response and creates nobody', async () => {
    const h = await start('      claims: { email: mail }\n');
    const { relayState, requestId } = await begin(h);
    const error = await rejection(
      call(h, 'auth_saml_complete', {
        samlResponse: answer(requestId, { sign: 'none' }),
        relayState,
      }),
    );
    expect(error.remoteCode).toBe('identity.saml_failed');
    expect(((await call(h, 'users_list', {})) as { users: unknown[] }).users).toEqual([]);
  });

  it('serves the metadata of the service', async () => {
    const h = await start();
    const { xml } = (await call(h, 'auth_saml_metadata', {})) as { xml: string };
    expect(xml).toContain(`entityID="${ENTITY}"`);
    expect(xml).toContain(`Location="${ACS}"`);
  });

  it('keeps running when the key file is gone: the server section is invalid and SAML is refused', async () => {
    const h = await start();
    const directory = join(String(h.environment.XDG_CONFIG_HOME), 'aip');
    writeFileSync(
      join(directory, 'settings.yaml'),
      `server:
  enabled: true
  public_url: "${PUBLIC_URL}"
  sso:
    saml:
      idp_metadata: "${join(directory, 'saml', 'idp.xml')}"
      key_file: "${join(directory, 'saml', 'absent.key')}"
      cert_file: "${join(directory, 'saml', 'saml.crt')}"
`,
    );
    const error = await rejection(call(h, 'auth_saml_begin', {}));
    expect(error.message).toMatch(/server mode is off/);
    expect(await call(h, 'status', {})).toBeDefined();
  });
});
