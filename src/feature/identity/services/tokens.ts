import { invalid, notFound } from '../../../platform/errors/index.ts';
import type { ServerSettings } from '../../swarm-config/types/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import type { TokensRepository } from '../repositories/index.ts';
import {
  type AccessToken,
  MINUTE,
  TOKEN_PREFIX,
  type User,
  isTokenFormat,
  parseTtl,
  tokenStart,
} from '../types/index.ts';

import { hashSecret } from './system.ts';
import type { UsersService } from './users.ts';

export interface TokensDependencies {
  tokens: TokensRepository;
  users: UsersService;
  settings: () => ServerSettings;
  clock: Clock;
  random: Random;
}

export class TokensService {
  private readonly deps: TokensDependencies;

  constructor(deps: TokensDependencies) {
    this.deps = deps;
  }

  /** Issues a token for a user; the value is returned once, the database keeps its hash. */
  create(userId: string, name: string, ttl: string | null): { value: string; token: AccessToken } {
    if (name.trim() === '') throw invalid('identity.token_name', 'a token needs a name');
    const max = parseTtl(this.deps.settings().tokenMaxTtl) ?? 90 * 86_400_000;
    const lifetime = ttl === null ? max : parseTtl(ttl);
    if (lifetime === null)
      throw invalid('identity.ttl', `\`${ttl}\` is not a duration such as 30d`);
    if (lifetime > max) {
      throw invalid(
        'identity.token_ttl',
        `a token lasts ${this.deps.settings().tokenMaxTtl} at most (server.token_max_ttl)`,
      );
    }
    const value = `${TOKEN_PREFIX}${this.deps.random.token(32)}`;
    const now = this.deps.clock.now();
    const token: AccessToken = {
      id: this.deps.random.id(),
      userId,
      name: name.trim(),
      start: tokenStart(value),
      createdAt: now,
      lastUsedAt: null,
      expiresAt: now + lifetime,
      revokedAt: null,
    };
    this.deps.tokens.insert(token, hashSecret(value));
    return { value, token };
  }

  list(userId: string): AccessToken[] {
    return this.deps.tokens.ofUser(userId);
  }

  /** Revokes a token of the user by name or by the start of its value; an administrator may revoke any (`byAdmin`). */
  revoke(userId: string, selector: string, byAdmin: boolean): AccessToken {
    const candidates = byAdmin
      ? this.deps.users.list().flatMap((user) => this.deps.tokens.ofUser(user.id))
      : this.deps.tokens.ofUser(userId);
    const found = candidates.filter(
      (token) =>
        token.id === selector ||
        token.name === selector ||
        (selector.length >= 4 && token.start.startsWith(selector)),
    );
    const own = found.filter((token) => token.userId === userId);
    const matches = own.length > 0 ? own : found;
    if (matches.length === 0)
      throw notFound('identity.token_not_found', `no token \`${selector}\``);
    if (matches.length > 1) {
      throw invalid(
        'identity.token_ambiguous',
        `several tokens match \`${selector}\`; use more characters`,
      );
    }
    const token = matches[0] as AccessToken;
    this.deps.tokens.revoke(token.id, this.deps.clock.now());
    return token;
  }

  /** The user of a token value; `null` when it is unknown, revoked or expired, or the user is disabled. */
  resolve(value: string): User | null {
    if (!isTokenFormat(value)) return null;
    const token = this.deps.tokens.byHash(hashSecret(value));
    const now = this.deps.clock.now();
    if (!token || token.revokedAt !== null || token.expiresAt <= now) return null;
    const user = this.deps.users.byId(token.userId);
    if (!user || user.disabled) return null;
    if (token.lastUsedAt === null || now - token.lastUsedAt >= MINUTE) {
      this.deps.tokens.touch(token.id, now);
    }
    return user;
  }
}
