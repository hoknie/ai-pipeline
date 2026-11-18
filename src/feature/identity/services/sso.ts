import { appError, conflict, unavailable } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { OidcSettings, ServerSettings } from '../../swarm-config/types/index.ts';
import type { Clock, OidcIdentity, OidcProvider, Random } from '../ports/index.ts';
import type { SsoRequestsRepository, UsersRepository } from '../repositories/index.ts';
import {
  type User,
  claimText,
  emailDomain,
  emailVerified,
  isEmail,
  mapAttributes,
} from '../types/index.ts';

import type { SessionsService } from './sessions.ts';

/** A sign-in request lives this long (the user signs in at the provider meanwhile). */
export const SSO_REQUEST_TTL = 10 * 60_000;

export interface SsoDependencies {
  database: Database;
  users: UsersRepository;
  requests: SsoRequestsRepository;
  sessions: SessionsService;
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
    if (!stored || stored.expiresAt <= this.deps.clock.now()) {
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

  private checkDomain(oidc: OidcSettings, email: string | null): void {
    if (oidc.allowedDomains.length === 0) return;
    const domain = email === null ? null : emailDomain(email);
    if (domain === null || !oidc.allowedDomains.includes(domain)) {
      throw appError(
        'forbidden',
        'identity.sso_domain',
        `sign-in is allowed for ${oidc.allowedDomains.join(', ')} only`,
      );
    }
  }

  private resolve(oidc: OidcSettings, identity: OidcIdentity): User {
    const { users } = this.deps;
    const email = claimText(identity.claims, oidc.claims.email);
    this.checkDomain(oidc, email);
    const attributes = mapAttributes(identity.claims, oidc.attributes);
    const subject = { issuer: identity.issuer, subject: identity.subject };
    const known = users.bySubject(subject.issuer, subject.subject);
    if (known?.disabled) {
      throw appError('forbidden', 'identity.user_disabled', 'the account is disabled');
    }
    if (known)
      return this.refresh(known, email, claimText(identity.claims, oidc.claims.name), attributes);
    if (email === null || !isEmail(email)) {
      throw refuse('identity.sso_email', 'the provider did not tell the email of the user');
    }
    const name = claimText(identity.claims, oidc.claims.name);
    const local = users.byEmail(email);
    if (!local) return this.create(email, name, attributes, subject);
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
    return this.refresh({ ...local, source: 'oidc', subject }, email, name, attributes);
  }

  private create(
    email: string,
    name: string | null,
    attributes: User['attributes'],
    subject: NonNullable<User['subject']>,
  ): User {
    const trimmed = email.trim();
    const user: User = {
      id: this.deps.random.id(),
      email: trimmed,
      name: name ?? trimmed.split('@')[0] ?? trimmed,
      attributes,
      source: 'oidc',
      subject,
      disabled: false,
      createdAt: this.deps.clock.now(),
      lastLoginAt: null,
    };
    this.deps.users.insert(user);
    return user;
  }

  /** Replaces the email, the name and the attributes with what the provider says now. */
  private refresh(
    user: User,
    email: string | null,
    name: string | null,
    attributes: User['attributes'],
  ): User {
    const next = email !== null && isEmail(email) ? email.trim() : user.email;
    const other = this.deps.users.byEmail(next);
    if (other && other.id !== user.id) {
      throw conflict('identity.sso_email_taken', `${next} belongs to another account`);
    }
    const changed = { ...user, email: next, name: name ?? user.name, attributes };
    this.deps.users.setProfile(user.id, changed.email, changed.name, attributes);
    return changed;
  }
}
