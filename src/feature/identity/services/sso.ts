import { appError, conflict, unavailable } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { OidcSettings, ServerSettings } from '../../swarm-config/types/index.ts';
import type { Clock, OidcIdentity, OidcProvider, Random } from '../ports/index.ts';
import type { SsoRequestsRepository, UsersRepository } from '../repositories/index.ts';
import type { SsoAccounts } from './sso-accounts.ts';
import { type User, claimText, emailVerified, isEmail, mapAttributes } from '../types/index.ts';

import type { SessionsService } from './sessions.ts';

/** The `codeVerifier` of a request row that belongs to a SAML sign-in (there is no PKCE in SAML). */
export const SAML_REQUEST = 'saml';

/** A sign-in request lives this long (the user signs in at the provider meanwhile). */
export const SSO_REQUEST_TTL = 10 * 60_000;

export interface SsoDependencies {
  database: Database;
  users: UsersRepository;
  requests: SsoRequestsRepository;
  sessions: SessionsService;
  accounts: SsoAccounts;
  settings: () => ServerSettings;
  /** The provider adapter; `null` while it cannot be built (no client secret). */
  provider: () => OidcProvider | null;
  clock: Clock;
  random: Random;
}

export interface SsoInfo {
  label: string;
  /** `false` when the provider cannot be used (the secret is missing). */
  ready: boolean;
  /** `true` when the last discovery of the provider failed; a new sign-in tries again. */
  unavailable: boolean;
}

export interface SsoSignIn {
  session: string;
  expiresAt: number;
  returnTo: string;
  user: User;
}

/** An address inside the panel: starts with one slash, no scheme, no host. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/';
  return value;
}

function refuse(code: string, message: string) {
  return appError('rejected', code, message);
}

export class SsoLoginService {
  private readonly deps: SsoDependencies;

  constructor(deps: SsoDependencies) {
    this.deps = deps;
  }

  private oidc(): OidcSettings | null {
    return this.deps.settings().sso.oidc;
  }

  /** What the login page shows; `null` when no provider is configured. */
  info(): SsoInfo | null {
    const oidc = this.oidc();
    if (!oidc) return null;
    const provider = this.deps.provider();
    return {
      label: oidc.label,
      ready: provider !== null,
      unavailable: provider?.status() === 'unavailable',
    };
  }

  private configured(): { oidc: OidcSettings; provider: OidcProvider; publicUrl: string } {
    const oidc = this.oidc();
    const provider = this.deps.provider();
    const publicUrl = this.deps.settings().publicUrl;
    if (!oidc || !provider || !publicUrl) {
      throw unavailable('identity.oidc_not_configured', 'sign-in through SSO is not configured');
    }
    return { oidc, provider, publicUrl };
  }

  /** Starts a sign-in: stores the request and returns the address of the provider. */
  async begin(request: { returnTo?: string | null }): Promise<{ url: string }> {
    const { provider, publicUrl } = this.configured();
    const now = this.deps.clock.now();
    const secrets = {
      redirectUri: `${publicUrl}/auth/oidc/callback`,
      state: this.deps.random.token(24),
      nonce: this.deps.random.token(24),
      codeVerifier: this.deps.random.token(32),
    };
    const url = await provider.authorizationUrl(secrets);
    this.deps.requests.removeExpired(now);
    this.deps.requests.insert(
      { ...secrets, returnTo: safeReturnTo(request.returnTo), expiresAt: now + SSO_REQUEST_TTL },
      now,
    );
    return { url };
  }

  /** Finishes a sign-in by the query string the provider sent the browser back with. */
  async complete(request: { query: string }): Promise<SsoSignIn> {
    const { oidc, provider } = this.configured();
    const params = new URLSearchParams(request.query.replace(/^\?/, ''));
    const state = params.get('state');
    const stored = state ? this.deps.requests.take(state) : null;
    if (
      !stored ||
      stored.codeVerifier === SAML_REQUEST ||
      stored.expiresAt <= this.deps.clock.now()
    ) {
      throw refuse(
        'identity.sso_state',
        'the sign-in request is unknown or has expired; start again',
      );
    }
    const refused = params.get('error');
    if (refused) {
      throw refuse(
        'identity.sso_refused',
        `the provider refused the sign-in: ${params.get('error_description') ?? refused}`,
      );
    }
    const identity = await provider.complete({
      redirectUri: stored.redirectUri,
      state: stored.state,
      nonce: stored.nonce,
      codeVerifier: stored.codeVerifier,
      callbackUrl: `${stored.redirectUri}?${params.toString()}`,
    });
    return this.deps.database.transaction(() => {
      const user = this.resolve(oidc, identity);
      const issued = this.deps.sessions.issue(user);
      return { ...issued, returnTo: stored.returnTo, user };
    });
  }

  private resolve(oidc: OidcSettings, identity: OidcIdentity): User {
    const { users, accounts } = this.deps;
    const email = claimText(identity.claims, oidc.claims.email);
    accounts.checkDomain(oidc.allowedDomains, email);
    const attributes = mapAttributes(identity.claims, oidc.attributes);
    const subject = { issuer: identity.issuer, subject: identity.subject };
    const known = users.bySubject(subject.issuer, subject.subject);
    if (known?.disabled) {
      throw appError('forbidden', 'identity.user_disabled', 'the account is disabled');
    }
    const name = claimText(identity.claims, oidc.claims.name);
    if (known) return accounts.refresh(known, email, name, attributes);
    if (email === null || !isEmail(email)) {
      throw refuse('identity.sso_email', 'the provider did not tell the email of the user');
    }
    const local = users.byEmail(email);
    if (!local) return accounts.create('oidc', email, name, attributes, subject);
    if (local.disabled) {
      throw appError('forbidden', 'identity.user_disabled', 'the account is disabled');
    }
    if (local.subject !== null) {
      throw conflict(
        'identity.sso_email_taken',
        `${email} belongs to another account of the provider`,
      );
    }
    if (!emailVerified(identity.claims)) {
      throw refuse(
        'identity.sso_unverified',
        `the provider did not verify ${email}; the existing account is not linked`,
      );
    }
    users.setSubject(local.id, subject);
    return accounts.refresh({ ...local, source: 'oidc', subject }, email, name, attributes);
  }
}
