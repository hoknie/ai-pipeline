import * as client from 'openid-client';

import { errorMessage, rejected, unavailable } from '../../../../platform/errors/index.ts';
import { verifyIdTokenSignature } from './signature.ts';
import type { OidcSettings } from '../../../swarm-config/types/index.ts';
import type { OidcIdentity, OidcProvider, OidcRequestSecrets } from '../../ports/index.ts';

/** How far the clocks of the daemon and of the provider may differ, in seconds. */
export const CLOCK_TOLERANCE_SECONDS = 60;

export interface OidcClientOptions {
  settings: OidcSettings;
  clientSecret: string;
  /** Called with the reason when the discovery fails; the next sign-in tries again. */
  warn: (message: string) => void;
  fetch?: typeof fetch;
}

/** The OpenID Connect adapter over `openid-client`; the discovery is repeated until it succeeds. */
export class OidcClient implements OidcProvider {
  private readonly options: OidcClientOptions;
  private configuration: client.Configuration | null = null;
  private state: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  constructor(options: OidcClientOptions) {
    this.options = options;
  }

  status(): 'unknown' | 'ready' | 'unavailable' {
    return this.state;
  }

  async check(): Promise<void> {
    await this.discover().catch(() => undefined);
  }

  private async discover(): Promise<client.Configuration> {
    if (this.configuration) return this.configuration;
    const { settings, clientSecret } = this.options;
    const discoveryOptions: client.DiscoveryRequestOptions = {};
    if (settings.issuer.startsWith('http:'))
      discoveryOptions.execute = [client.allowInsecureRequests];
    if (this.options.fetch) discoveryOptions[client.customFetch] = this.options.fetch;
    try {
      const configuration = await client.discovery(
        new URL(settings.issuer),
        settings.clientId,
        { client_secret: clientSecret, [client.clockTolerance]: CLOCK_TOLERANCE_SECONDS },
        undefined,
        discoveryOptions,
      );
      this.configuration = configuration;
      this.state = 'ready';
      return configuration;
    } catch (error) {
      const reason = `OIDC provider ${settings.issuer} is not available: ${errorMessage(error)}`;
      this.state = 'unavailable';
      this.options.warn(reason);
      throw unavailable('identity.oidc_unavailable', reason);
    }
  }

  async authorizationUrl(request: OidcRequestSecrets): Promise<string> {
    const configuration = await this.discover();
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: request.redirectUri,
      scope: this.options.settings.scopes.join(' '),
      state: request.state,
      nonce: request.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(request.codeVerifier),
      code_challenge_method: 'S256',
    });
    return url.href;
  }

  async complete(request: OidcRequestSecrets & { callbackUrl: string }): Promise<OidcIdentity> {
    const configuration = await this.discover();
    const callback = new URL(request.callbackUrl);
    try {
      const tokens = await client.authorizationCodeGrant(configuration, callback, {
        pkceCodeVerifier: request.codeVerifier,
        expectedState: request.state,
        expectedNonce: request.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || !tokens.id_token) throw new Error('the provider returned no id token');
      const jwksUri = configuration.serverMetadata().jwks_uri;
      if (!jwksUri) throw new Error('the provider publishes no jwks_uri');
      await verifyIdTokenSignature(tokens.id_token, jwksUri, this.options.fetch ?? fetch);
      return { issuer: claims.iss, subject: claims.sub, claims: { ...claims } };
    } catch (error) {
      throw rejected(`sign-in failed: ${errorMessage(error)}`, 'identity.oidc_failed');
    }
  }
}
