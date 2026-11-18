/** Who the provider says the user is: the issuer, the subject and the claims of the id token. */
export interface OidcIdentity {
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
}

/** What a sign-in request keeps between the redirect and the return of the browser. */
export interface OidcRequestSecrets {
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** An OpenID Connect provider: the authorization code flow with PKCE. */
export interface OidcProvider {
  /** What the last discovery found: `unknown` before the first one. */
  status(): 'unknown' | 'ready' | 'unavailable';
  /** Runs the discovery now; never fails, the outcome is in `status()`. */
  check(): Promise<void>;
  /** The address the browser goes to; fails with `unavailable` while the provider cannot be reached. */
  authorizationUrl(request: OidcRequestSecrets): Promise<string>;
  /**
   * Exchanges the code of the returned address for tokens and checks the id token (signature,
   * expiry, issuer, audience, nonce) and the state; fails with `rejected` when a check fails.
   */
  complete(request: OidcRequestSecrets & { callbackUrl: string }): Promise<OidcIdentity>;
}
