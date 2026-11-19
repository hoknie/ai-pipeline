import { appError, conflict } from '../../../platform/errors/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import type { UsersRepository } from '../repositories/index.ts';
import { type User, type UserSubject, emailDomain, isEmail } from '../types/index.ts';

export interface SsoAccountsDependencies {
  users: UsersRepository;
  clock: Clock;
  random: Random;
}

/** What both providers do with the accounts of the users that sign in: restrict, create, update, link. */
export class SsoAccounts {
  private readonly deps: SsoAccountsDependencies;

  constructor(deps: SsoAccountsDependencies) {
    this.deps = deps;
  }

  /** Fails with `forbidden` unless the email is of an allowed domain (all are allowed with none listed). */
  checkDomain(allowed: string[], email: string | null): void {
    if (allowed.length === 0) return;
    const domain = email === null ? null : emailDomain(email);
    if (domain === null || !allowed.includes(domain)) {
      throw appError(
        'forbidden',
        'identity.sso_domain',
        `sign-in is allowed for ${allowed.join(', ')} only`,
      );
    }
  }

  create(
    source: 'oidc' | 'saml',
    email: string,
    name: string | null,
    attributes: User['attributes'],
    subject: UserSubject,
  ): User {
    const trimmed = email.trim();
    const user: User = {
      id: this.deps.random.id(),
      email: trimmed,
      name: name ?? trimmed.split('@')[0] ?? trimmed,
      attributes,
      source,
      subject,
      disabled: false,
      createdAt: this.deps.clock.now(),
      lastLoginAt: null,
    };
    this.deps.users.insert(user);
    return user;
  }

  /** Replaces the email, the name and the attributes with what the provider says now. */
  refresh(
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
