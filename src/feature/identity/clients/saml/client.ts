import {
  type CacheProvider,
  SAML,
  ValidateInResponseTo,
  generateServiceProviderMetadata,
} from '@node-saml/node-saml';

import { errorMessage, rejected, unavailable } from '../../../../platform/errors/index.ts';
import type {
  SamlAssertionStore,
  SamlIdentity,
  SamlProvider,
  SamlRequestIds,
} from '../../ports/index.ts';
import type { IdpMetadata, IdpMetadataSource } from './idp-metadata.ts';

/** How far the clocks of the daemon and of the provider may differ, in milliseconds. */
export const SAML_CLOCK_TOLERANCE_MS = 60_000;

export interface SamlClientOptions {
  /** The entityID of the service. */
  entityId: string;
  /** `<public_url>/auth/saml/acs`. */
  acsUrl: string;
  /** The PEM texts of the signing key and certificate of the service. */
  privateKey: string;
  certificate: string;
  metadata: IdpMetadataSource;
  /** Where the accepted assertions are remembered. */
  assertions: SamlAssertionStore;
}

/** The root `Destination` of a response, when it names one. */
function destinationOf(samlResponse: string): string | null {
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  const root = /<(?:[\w-]+:)?Response\b[^>]*>/.exec(xml)?.[0] ?? '';
  return /\sDestination\s*=\s*"([^"]*)"/.exec(root)?.[1] ?? null;
}

function toIdentity(profile: Record<string, unknown>): SamlIdentity {
  const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
  return {
    issuer: String(profile.issuer ?? ''),
    nameId: String(profile.nameID ?? ''),
    nameIdFormat: typeof profile.nameIDFormat === 'string' ? profile.nameIDFormat : null,
    attributes,
  };
}

/**
 * The SAML adapter over `@node-saml/node-saml`: the library checks the XML signature, the Audience,
 * the validity period, InResponseTo and the replay of the assertion; this class feeds it the request
 * and the store of accepted assertions, and checks the Destination.
 */
export class SamlClient implements SamlProvider {
  private readonly options: SamlClientOptions;

  constructor(options: SamlClientOptions) {
    this.options = options;
  }

  status(): 'unknown' | 'ready' | 'unavailable' {
    return this.options.metadata.status();
  }

  async check(): Promise<void> {
    await this.options.metadata.load();
  }

  private cache(requestId: string | null): CacheProvider {
    return {
      saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
      getAsync: async (key) => (key === requestId ? new Date().toISOString() : null),
      removeAsync: async (key) => (key !== null && key === requestId ? key : null),
      consumeAsync: async (key) => (key === requestId ? new Date().toISOString() : null),
      saveIfAbsentAsync: async (key, _value, expiresAtMs) =>
        this.options.assertions.remember(key, expiresAtMs),
    };
  }

  private saml(idp: IdpMetadata, requestId: string): SAML {
    const { entityId, acsUrl, privateKey, certificate } = this.options;
    return new SAML({
      callbackUrl: acsUrl,
      entryPoint: idp.ssoUrl,
      issuer: entityId,
      audience: entityId,
      idpIssuer: idp.entityId,
      idpCert: idp.certificates,
      privateKey,
      publicCert: certificate,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
      identifierFormat: null,
      // either the response or the assertion must carry a valid signature; the library refuses a message with none
      wantAssertionsSigned: false,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      rejectReplayedAssertions: true,
      acceptedClockSkewMs: SAML_CLOCK_TOLERANCE_MS,
      generateUniqueId: () => requestId,
      cacheProvider: this.cache(requestId),
    });
  }

  async authorizeUrl(request: SamlRequestIds): Promise<string> {
    const idp = await this.options.metadata.get();
    try {
      return await this.saml(idp, request.requestId).getAuthorizeUrlAsync(
        request.relayState,
        undefined,
        {},
      );
    } catch (error) {
      throw unavailable(
        'identity.saml_failed',
        `cannot build the sign-in request: ${errorMessage(error)}`,
      );
    }
  }

  async validatePostResponse(response: {
    samlResponse: string;
    requestId: string;
  }): Promise<SamlIdentity> {
    const idp = await this.options.metadata.get();
    const destination = destinationOf(response.samlResponse);
    if (destination !== null && destination !== this.options.acsUrl) {
      throw rejected(
        `sign-in failed: the response is addressed to ${destination}`,
        'identity.saml_failed',
      );
    }
    try {
      const { profile } = await this.saml(idp, response.requestId).validatePostResponseAsync({
        SAMLResponse: response.samlResponse,
      });
      if (!profile?.nameID) throw new Error('the response names no user');
      return toIdentity(profile);
    } catch (error) {
      throw rejected(`sign-in failed: ${errorMessage(error)}`, 'identity.saml_failed');
    }
  }

  serviceMetadata(): string {
    const { entityId, acsUrl, certificate, privateKey } = this.options;
    return generateServiceProviderMetadata({
      privateKey,
      issuer: entityId,
      callbackUrl: acsUrl,
      publicCerts: certificate,
      identifierFormat: null,
      wantAssertionsSigned: true,
    });
  }
}
