/** Who the provider says the user is: the entityID of the provider, the NameID and the attributes of the assertion. */
export interface SamlIdentity {
  issuer: string;
  nameId: string;
  nameIdFormat: string | null;
  /** The attributes of the assertion by name; a single value is a string, several are a list. */
  attributes: Record<string, unknown>;
}

/** What the service keeps between the redirect to the provider and the answer of the browser. */
export interface SamlRequestIds {
  /** The ID of the AuthnRequest, which the response names in `InResponseTo`. */
  requestId: string;
  /** Comes back with the response and finds the stored request. */
  relayState: string;
}

/** Remembers the assertions that were accepted; `false` when the assertion is already known. */
export interface SamlAssertionStore {
  remember(id: string, expiresAt: number): boolean;
}

/** A SAML 2.0 provider: SP-initiated sign-in with the HTTP-Redirect request and the HTTP-POST response. */
export interface SamlProvider {
  /** What the last load of the metadata of the provider found: `unknown` before the first one. */
  status(): 'unknown' | 'ready' | 'unavailable';
  /** Loads the metadata of the provider now; never fails, the outcome is in `status()`. */
  check(): Promise<void>;
  /** The signed AuthnRequest as an address of the provider; fails with `unavailable` while there are no metadata. */
  authorizeUrl(request: SamlRequestIds): Promise<string>;
  /**
   * Checks a POST response (signature of the response or of the assertion, Audience, Destination,
   * InResponseTo, validity period, replay) and returns the identity; fails with `rejected` otherwise.
   */
  validatePostResponse(response: {
    samlResponse: string;
    requestId: string;
  }): Promise<SamlIdentity>;
  /** The XML metadata of the service. */
  serviceMetadata(): string;
}
