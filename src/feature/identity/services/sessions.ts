import { invalid, appError } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { ServerSettings } from '../../swarm-config/types/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import type { LoginLinksRepository, SessionsRepository } from '../repositories/index.ts';
import { LOGIN_LINK_DEFAULT_TTL, LOGIN_LINK_MAX_TTL, type User, parseTtl } from '../types/index.ts';

import { hashSecret } from './system.ts';
import type { UsersService } from './users.ts';

export interface SessionsDependencies {
  database: Database;
  users: UsersService;
  sessions: SessionsRepository;
  links: LoginLinksRepository;
  settings: () => ServerSettings;
  clock: Clock;
  random: Random;
}

export interface LoginLinkRequest {
  email: string;
  name?: string | null;
  admin?: boolean;
  /** `<n>m`, `<n>h` or `<n>d`; 15 minutes by default, 7 days at most. */
  ttl?: string | null;
}

export class SessionsService {
  private readonly deps: SessionsDependencies;

  constructor(deps: SessionsDependencies) {
    this.deps = deps;
  }

  /** A one-time login code; its hash is stored. The user is created when the link is first used. */
  createLink(request: LoginLinkRequest): { code: string; expiresAt: number } {
    const ttl = request.ttl ? parseTtl(request.ttl) : LOGIN_LINK_DEFAULT_TTL;
    if (ttl === null)
      throw invalid('identity.ttl', `\`${request.ttl}\` is not a duration such as 15m`);
    if (ttl > LOGIN_LINK_MAX_TTL)
      throw invalid('identity.ttl', 'a login link lasts 7 days at most');
    if (!request.email.includes('@')) {
      throw invalid('identity.email', `\`${request.email}\` is not an email address`);
    }
    const code = this.deps.random.token(32);
    const now = this.deps.clock.now();
    const expiresAt = now + ttl;
    this.deps.links.insert(
      hashSecret(code),
      {
        email: request.email.trim(),
        name: request.name ?? null,
        admin: request.admin === true,
        expiresAt,
      },
      now,
    );
    return { code, expiresAt };
  }

  /** Signs a user in by a link: the link is marked used in the same transaction as the session is created. */
  loginByLink(code: string): { session: string; user: User; expiresAt: number } {
    const hash = hashSecret(code);
    return this.deps.database.transaction(() => {
      const link = this.deps.links.byHash(hash);
      const now = this.deps.clock.now();
      if (!link)
        throw appError('not_found', 'identity.link_unknown', 'the login link is not valid');
      if (link.usedAt !== null) {
        throw appError('rejected', 'identity.link_used', 'the login link was already used');
      }
      if (link.expiresAt <= now) {
        throw appError('rejected', 'identity.link_expired', 'the login link has expired');
      }
      const existing = this.deps.users.byEmail(link.email);
      if (existing?.disabled) {
        throw appError('forbidden', 'identity.user_disabled', 'the account is disabled');
      }
      const user = this.deps.users.ensure(link.email, link.name, link.admin);
      this.deps.links.markUsed(hash, now);
      const issued = this.issue(user);
      return { ...issued, user };
    });
  }

  /** A session of a user who signed in by another means (a provider). */
  issue(user: User): { session: string; expiresAt: number } {
    const session = this.deps.random.token(32);
    const now = this.deps.clock.now();
    const ttl = parseTtl(this.deps.settings().sessionTtl) ?? 12 * 3_600_000;
    const expiresAt = now + ttl;
    this.deps.sessions.insert(hashSecret(session), user.id, now, expiresAt);
    this.deps.users.touchLogin(user.id, now);
    return { session, expiresAt };
  }

  /** The user of a session value; `null` when it is unknown, expired, or the user is disabled. */
  resolve(session: string): User | null {
    const hash = hashSecret(session);
    const record = this.deps.sessions.byHash(hash);
    if (!record) return null;
    if (record.expiresAt <= this.deps.clock.now()) {
      this.deps.sessions.remove(hash);
      return null;
    }
    const user = this.deps.users.byId(record.userId);
    return user && !user.disabled ? user : null;
  }

  logout(session: string): void {
    this.deps.sessions.remove(hashSecret(session));
  }
}
