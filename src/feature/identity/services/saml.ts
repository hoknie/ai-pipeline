import { appError, conflict, unavailable } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import {
  type SamlSettings,
  type ServerSettings,
  samlEntityId,
} from '../../swarm-config/types/index.ts';
import type { Clock, Random, SamlIdentity, SamlProvider } from '../ports/index.ts';
import type { SsoRequestsRepository, UsersRepository } from '../repositories/index.ts';
import { type User, claimText, isEmail, mapAttributes } from '../types/index.ts';

import type { SessionsService } from './sessions.ts';
import {
  SAML_REQUEST,
  SSO_REQUEST_TTL,
  safeReturnTo,
  type SsoInfo,
  type SsoSignIn,
} from './sso.ts';
import type { SsoAccounts } from './sso-accounts.ts';

export interface SamlLoginDependencies {
  database: Database;
  users: UsersRepository;
  requests: SsoRequestsRepository;
  sessions: SessionsService;
  accounts: SsoAccounts;
  settings: () => ServerSettings;
  /** The adapter; `null` while it cannot be built (the key or the certificate cannot be read). */
  provider: () => SamlProvider | null;
  clock: Clock;
  random: Random;
}

function refuse(code: string, message: string) {
  return appError('rejected', code, message);
}

const disabled = () => appError('forbidden', 'identity.user_disabled', 'the account is disabled');

/**
 * The SAML sign-in: the request is stored under the RelayState with the ID of the AuthnRequest, the
 * response of the provider is checked by the adapter and then maps to a user like the OIDC one does.
 */
export class SamlLoginService {
  private readonly deps: SamlLoginDependencies;

  constructor(deps: SamlLoginDependencies) {
    this.deps = deps;
  }

  private saml(): SamlSettings | null {
    return this.deps.settings().sso.saml;
  }

  /** What the login page shows; `null` when no provider is configured. */
  info(): SsoInfo | null {
    const saml = this.saml();
    if (!saml) return null;
    const provider = this.deps.provider();
    return {
      label: saml.label,
      ready: provider !== null,
      unavailable: provider?.status() === 'unavailable',
    };
  }

  private configured(): { saml: SamlSettings; provider: SamlProvider; publicUrl: string } {
    const saml = this.saml();
    const provider = this.deps.provider();
    const publicUrl = this.deps.settings().publicUrl;
    if (!saml || !provider || !publicUrl) {
      throw unavailable('identity.saml_not_configured', 'sign-in through SAML is not configured');
    }
    return { saml, provider, publicUrl };
  }

  /** The XML metadata of the service, for the administrator of the provider. */
  metadata(): { xml: string } {
    return { xml: this.configured().provider.serviceMetadata() };
  }

  /** Starts a sign-in: stores the request and returns the address of the provider. */
  async begin(request: { returnTo?: string | null }): Promise<{ url: string }> {
    const { provider, publicUrl } = this.configured();
    const now = this.deps.clock.now();
    const relayState = this.deps.random.token(24);
    const requestId = `_${relayState}`;
    const url = await provider.authorizeUrl({ requestId, relayState });
    this.deps.requests.removeExpired(now);
    this.deps.requests.insert(
      {
        state: relayState,
        nonce: requestId,
        codeVerifier: SAML_REQUEST,
        redirectUri: `${publicUrl}/auth/saml/acs`,
        returnTo: safeReturnTo(request.returnTo),
        expiresAt: now + SSO_REQUEST_TTL,
      },
      now,
    );
    return { url };
  }

  /** Finishes a sign-in by the fields of the form the provider posted to the ACS address. */
  async complete(request: { samlResponse: string; relayState: string }): Promise<SsoSignIn> {
    const { saml, provider } = this.configured();
    const stored = request.relayState ? this.deps.requests.take(request.relayState) : null;
    if (
      !stored ||
      stored.codeVerifier !== SAML_REQUEST ||
      stored.expiresAt <= this.deps.clock.now()
    ) {
      throw refuse(
        'identity.sso_state',
        'the sign-in request is unknown or has expired; start again',
      );
    }
    const identity = await provider.validatePostResponse({
      samlResponse: request.samlResponse,
      requestId: stored.nonce,
    });
    return this.deps.database.transaction(() => {
      const user = this.resolve(saml, identity);
      const issued = this.deps.sessions.issue(user);
      return { ...issued, returnTo: stored.returnTo, user };
    });
  }

  private resolve(saml: SamlSettings, identity: SamlIdentity): User {
    const { users, accounts } = this.deps;
    const email = saml.claims.email
      ? claimText(identity.attributes, saml.claims.email)
      : identity.nameId;
    accounts.checkDomain(saml.allowedDomains, email);
    const attributes = mapAttributes(identity.attributes, saml.attributes);
    const name = saml.claims.name ? claimText(identity.attributes, saml.claims.name) : null;
    const subject = { issuer: identity.issuer, subject: identity.nameId };
    const known = users.bySubject(subject.issuer, subject.subject);
    if (known?.disabled) throw disabled();
    if (known) return accounts.refresh(known, email, name, attributes);
    if (email === null || !isEmail(email)) {
      throw refuse('identity.sso_email', 'the provider did not tell the email of the user');
    }
    const local = users.byEmail(email);
    if (!local) return accounts.create('saml', email, name, attributes, subject);
    if (local.disabled) throw disabled();
    if (local.subject !== null) {
      throw conflict(
        'identity.sso_email_taken',
        `${email} belongs to another account of the provider`,
      );
    }
    if (!saml.trustEmail) {
      throw refuse(
        'identity.sso_unverified',
        `${email} belongs to an existing account; set server.sso.saml.trust_email to link it`,
      );
    }
    users.setSubject(local.id, subject, 'saml');
    return accounts.refresh({ ...local, source: 'saml', subject }, email, name, attributes);
  }
}
