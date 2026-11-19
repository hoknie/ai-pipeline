import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { harness, type Harness } from '../daemon/harness.ts';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeOidcProvider } from '../fakes/oidc-provider.ts';
import { FakeKeyPair, FakeSamlIdp, redirectParts, writeSamlFiles } from '../fakes/saml-provider.ts';

let current: Harness | null = null;
let web: WebServer | null = null;
let oidc: FakeOidcProvider | null = null;
let base = '';

const idp = new FakeSamlIdp();
const service = new FakeKeyPair('aip');

afterEach(async () => {
  await web?.close();
  web = null;
  await current?.close();
  current = null;
  await oidc?.stop();
  oidc = null;
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function start(options: { oidc?: boolean; saml?: string } = {}): Promise<Harness> {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  current = await harness(undefined, { AIP_OIDC_SECRET: FAKE_CLIENT_SECRET });
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  let providers = writeSamlFiles(
    join(directory, 'saml'),
    idp,
    service,
    options.saml ??
      '      label: ADFS\n      claims: { email: mail }\n      attributes: { groups: groups }\n',
  );
  if (options.oidc) {
    oidc = await new FakeOidcProvider().start();
    providers = `    oidc:
      issuer: "${oidc.issuer}"
      client_id: ${FAKE_CLIENT_ID}
      client_secret_env: AIP_OIDC_SECRET
      label: Keycloak
${providers}`;
  }
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server:
  enabled: true
  public_url: "${base}"
  sso:
${providers}`,
  );
  web = await startWebServer({
    socket: current.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: base, trustedProxies: [] },
  });
  return current;
}

function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port: web?.port, path, method, headers },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const location = (answer: Answer): string => String(answer.headers.location);

function cookieOf(answer: Answer): string | null {
  const header = answer.headers['set-cookie'] as string[] | undefined;
  return header?.[0]?.split(';')[0] ?? null;
}

/** What the browser posts from the site of the provider: no cookie of the panel, the origin of the provider. */
function postToAcs(samlResponse: string, relayState: string): Promise<Answer> {
  return send(
    'POST',
    '/auth/saml/acs',
    { origin: 'https://idp.corp.com', 'content-type': 'application/x-www-form-urlencoded' },
    new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }).toString(),
  );
}

/** The panel sends the browser to the provider; the answer of the provider is built for that request. */
async function begin(returnTo?: string) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  const started = await send('GET', `/auth/saml/start${query}`);
  expect(started.status).toBe(302);
  expect(location(started).startsWith(idp.ssoUrl)).toBe(true);
  const { relayState, requestXml } = redirectParts(location(started));
  return { relayState, requestId: /ID="([^"]+)"/.exec(requestXml)![1]! };
}

const response = (
  requestId: string,
  options: Partial<Parameters<FakeSamlIdp['response']>[0]> = {},
) =>
  idp.response({
    requestId,
    acsUrl: `${base}/auth/saml/acs`,
    audience: `${base}/auth/saml/metadata`,
    attributes: { mail: 'alice@corp.com', groups: ['dev', 'ops'] },
    ...options,
  });

async function whoami(cookie: string) {
  const answer = await send(
    'POST',
    '/api/ipc',
    { cookie, origin: base, 'content-type': 'application/json' },
    JSON.stringify({ method: 'whoami', params: {} }),
  );
  return JSON.parse(answer.body) as {
    user: { email: string; source: string; attributes: Record<string, string[]> } | null;
  };
}

describe('sign-in through SAML in the panel', () => {
  it('shows the button, signs in through the ACS and returns to the page', async () => {
    await start();
    const page = await send('GET', '/auth/login');
    expect(page.body).toContain('/auth/saml/start');
    expect(page.body).toContain('Sign in with ADFS');
    const { relayState, requestId } = await begin('/queue');
    const back = await postToAcs(response(requestId), relayState);
    expect(back.status).toBe(302);
    expect(location(back)).toBe('/queue');
    const cookie = cookieOf(back);
    expect(cookie).toMatch(/^aip_session=/);
    expect(await whoami(cookie!)).toMatchObject({
      user: { email: 'alice@corp.com', source: 'saml', attributes: { groups: ['dev', 'ops'] } },
    });
  });

  it('refuses the same assertion posted twice and sets no second session', async () => {
    await start();
    const { relayState, requestId } = await begin();
    const body = response(requestId, { assertionId: '_once' });
    expect(cookieOf(await postToAcs(body, relayState))).not.toBeNull();
    const again = await postToAcs(body, relayState);
    expect(again.status).toBe(400);
    expect(again.body).toContain('Cannot sign in');
    expect(cookieOf(again)).toBeNull();
    const next = await begin();
    const replay = await postToAcs(
      response(next.requestId, { assertionId: '_once' }),
      next.relayState,
    );
    expect(replay.status).toBe(400);
    expect(cookieOf(replay)).toBeNull();
  });

  it('refuses unsigned, wrongly signed and misaddressed responses without a session', async () => {
    await start();
    for (const options of [
      { sign: 'none' as const },
      { sign: 'foreign' as const },
      { wrongAudience: 'https://other.example.com' },
    ]) {
      const { relayState, requestId } = await begin();
      const answer = await postToAcs(response(requestId, options), relayState);
      expect(answer.status).toBe(400);
      expect(cookieOf(answer)).toBeNull();
    }
    const unknown = await postToAcs(response('_nope'), 'forged');
    expect(unknown.status).toBe(400);
    expect(cookieOf(unknown)).toBeNull();
  });

  it('takes the ACS from another origin but no other post of a foreign origin', async () => {
    await start();
    const foreign = await send('POST', '/auth/logout', { origin: 'https://idp.corp.com' });
    expect(foreign.status).toBe(403);
    const acs = await postToAcs('x', 'y');
    expect(acs.status).toBe(400);
    const get = await send('GET', '/auth/saml/acs');
    expect(get.status).toBe(404);
  });

  it('serves the metadata of the service without a session', async () => {
    await start();
    const metadata = await send('GET', '/auth/saml/metadata');
    expect(metadata.status).toBe(200);
    expect(String(metadata.headers['content-type'])).toContain('xml');
    expect(metadata.body).toContain(`entityID="${base}/auth/saml/metadata"`);
    expect(metadata.body).toMatch(
      new RegExp(`AssertionConsumerService[^>]*Location="${base}/auth/saml/acs"`),
    );
  });

  it('shows both buttons when OIDC and SAML are configured', async () => {
    await start({ oidc: true });
    const page = await send('GET', '/auth/login');
    expect(page.body).toContain('Sign in with Keycloak');
    expect(page.body).toContain('Sign in with ADFS');
    expect(page.body).toContain('/auth/oidc/start');
    expect(page.body).toContain('/auth/saml/start');
  });

  it('keeps the SAML start of the login page with the page to return to', async () => {
    await start();
    const target = '/auth/cli?port=9999&state=abcdefgh&challenge=c&machine=m';
    const page = await send('GET', target);
    expect(page.status).toBe(401);
    expect(page.body).toContain(`/auth/saml/start?returnTo=${encodeURIComponent(target)}`);
  });
});
