import { conflict, invalid, notFound } from '../../../platform/errors/index.ts';
import type { Database } from '../../../platform/sqlite/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import type {
  SessionsRepository,
  TokensRepository,
  UsersRepository,
} from '../repositories/index.ts';
import { type Attributes, type User, emailKey, hasAdminRole, isEmail } from '../types/index.ts';

export interface UsersDependencies {
  database: Database;
  users: UsersRepository;
  sessions: SessionsRepository;
  tokens: TokensRepository;
  clock: Clock;
  random: Random;
}

export class UsersService {
  private readonly deps: UsersDependencies;

  constructor(deps: UsersDependencies) {
    this.deps = deps;
  }

  list(): User[] {
    return this.deps.users.all();
  }

  byId(id: string): User | null {
    return this.deps.users.byId(id);
  }

  byEmail(email: string): User | null {
    return this.deps.users.byEmail(email);
  }

  /** A user of the email; created with the source `local` when there is none (the email is not case sensitive). */
  ensure(email: string, name: string | null, admin: boolean): User {
    const existing = this.deps.users.byEmail(email);
    if (existing) {
      if (admin && !hasAdminRole(existing.attributes)) {
        const attributes = {
          ...existing.attributes,
          role: [...(existing.attributes.role ?? []), 'admin'],
        };
        this.deps.users.setAttributes(existing.id, attributes);
        return { ...existing, attributes };
      }
      return existing;
    }
    if (!isEmail(email)) throw invalid('identity.email', `\`${email}\` is not an email address`);
    const trimmed = email.trim();
    const user: User = {
      id: this.deps.random.id(),
      email: trimmed,
      name: name?.trim() || trimmed.split('@')[0] || trimmed,
      attributes: admin ? { role: ['admin'] } : {},
      source: 'local',
      subject: null,
      disabled: false,
      createdAt: this.deps.clock.now(),
      lastLoginAt: null,
    };
    this.deps.users.insert(user);
    return user;
  }

  touchLogin(id: string, at: number): void {
    this.deps.users.setLastLogin(id, at);
  }

  private require(email: string): User {
    const user = this.deps.users.byEmail(email);
    if (!user) throw notFound('identity.user_not_found', `no user ${emailKey(email)}`);
    return user;
  }

  private activeAdmins(except: string): number {
    return this.deps.users
      .all()
      .filter((user) => user.id !== except && !user.disabled && hasAdminRole(user.attributes))
      .length;
  }

  private keepAnAdmin(user: User): void {
    if (!user.disabled && hasAdminRole(user.attributes) && this.activeAdmins(user.id) === 0) {
      throw conflict(
        'identity.last_admin',
        'this would leave no active administrator; make another user an administrator first',
      );
    }
  }

  /** Replaces the given attributes of a `local` user; an empty list removes the attribute. */
  setAttributes(email: string, changes: Attributes): User {
    const user = this.require(email);
    if (user.source !== 'local') {
      throw invalid(
        'identity.attributes_external',
        'attributes of this user come from the provider',
      );
    }
    const attributes: Attributes = { ...user.attributes };
    for (const [name, values] of Object.entries(changes)) {
      if (values.length === 0) delete attributes[name];
      else attributes[name] = values;
    }
    if (hasAdminRole(user.attributes) && !hasAdminRole(attributes)) this.keepAnAdmin(user);
    this.deps.users.setAttributes(user.id, attributes);
    return { ...user, attributes };
  }

  /** Disables a user: the sessions are removed and the tokens revoked. */
  disable(email: string): User {
    const user = this.require(email);
    this.keepAnAdmin(user);
    this.deps.database.transaction(() => {
      this.deps.users.setDisabled(user.id, true);
      this.deps.sessions.removeOfUser(user.id);
      this.deps.tokens.revokeOfUser(user.id, this.deps.clock.now());
    });
    return { ...user, disabled: true };
  }

  enable(email: string): User {
    const user = this.require(email);
    this.deps.users.setDisabled(user.id, false);
    return { ...user, disabled: false };
  }
}
