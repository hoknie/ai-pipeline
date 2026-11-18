import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_CLIENT_ID = 'aip-client';
export const FAKE_CLIENT_SECRET = 'fake-secret';

interface Grant {
  nonce: string | null;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

export interface IssueOptions {
  /** Replaces the claims of the id token after the defaults (`exp`, `aud`, `iss`, ...). */
  override?: Record<string, unknown>;
  /** Signs with a key that is not in the JWKS. */
  badSignature?: boolean;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

/** A provider on `node:http`: discovery, JWKS, token endpoint with PKCE; the browser is simulated. */
export class FakeOidcProvider {
  issuer = '';
  discoveryHits = 0;
  /** Answers every discovery request with 500 while true. */
  down = false;
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly grants = new Map<string, Grant & { options: IssueOptions }>();
  private readonly server: Server;

  constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () =>
        this.handle(
          request.url ?? '/',
          request.headers,
          Buffer.concat(chunks).toString(),
          response,
        ),
      );
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /**
   * The browser signs in at the provider: from the authorization address of the daemon to the
   * address it comes back to (`redirect_uri?code=..&state=..`).
   */
  authorize(
    authorizationUrl: string,
    claims: Record<string, unknown>,
    options: IssueOptions = {},
  ): string {
    const url = new URL(authorizationUrl);
    const code = randomBytes(12).toString('hex');
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    this.grants.set(code, {
      nonce: url.searchParams.get('nonce'),
      challenge: url.searchParams.get('code_challenge') ?? '',
      redirectUri,
      claims,
      options,
    });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return back.href;
  }

  private jwt(payload: Record<string, unknown>, bad: boolean): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
    const body = base64url(JSON.stringify(payload));
    const signer = createSign('RSA-SHA256').update(`${header}.${body}`);
    const signature = signer.sign((bad ? this.other : this.key).privateKey);
    return `${header}.${body}.${base64url(signature)}`;
  }

  private idToken(grant: Grant & { options: IssueOptions }): string {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.issuer,
      aud: FAKE_CLIENT_ID,
      iat: now,
      exp: now + 300,
      ...(grant.nonce === null ? {} : { nonce: grant.nonce }),
      ...grant.claims,
      ...grant.options.override,
    };
    return this.jwt(claims, grant.options.badSignature === true);
  }

  private handle(
    path: string,
    headers: Record<string, string | string[] | undefined>,
    body: string,
    response: import('node:http').ServerResponse,
  ): void {
    const send = (status: number, value: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (path === '/.well-known/openid-configuration') {
      this.discoveryHits += 1;
      if (this.down) return send(500, { error: 'down' });
      return send(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (path === '/jwks') {
      const jwk = this.key.publicKey.export({ format: 'jwk' });
      return send(200, { keys: [{ ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' }] });
    }
    if (path === '/token') return this.token(headers, body, send);
    return send(404, { error: 'not found' });
  }

  private token(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    send: (status: number, value: unknown) => void,
  ): void {
    const form = new URLSearchParams(body);
    const basic = String(headers.authorization ?? '');
    const secret = basic.startsWith('Basic ')
      ? decodeURIComponent(Buffer.from(basic.slice(6), 'base64').toString().split(':')[1] ?? '')
      : form.get('client_secret');
    const grant = this.grants.get(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (secret !== FAKE_CLIENT_SECRET) return send(401, { error: 'invalid_client' });
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get('redirect_uri')) {
      return send(400, { error: 'invalid_grant' });
    }
    this.grants.delete(form.get('code') ?? '');
    return send(200, {
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: this.idToken(grant),
    });
  }
}
