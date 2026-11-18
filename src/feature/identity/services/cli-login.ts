import { appError, invalid } from '../../../platform/errors/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import type { CliCodesRepository } from '../repositories/index.ts';
import { CLI_CODE_TTL, type User } from '../types/index.ts';

import { hashSecret, pkceChallenge } from './system.ts';
import type { TokensService } from './tokens.ts';
import type { UsersService } from './users.ts';

export interface CliLoginDependencies {
  codes: CliCodesRepository;
  users: UsersService;
  tokens: TokensService;
  clock: Clock;
  random: Random;
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export class CliLoginService {
  private readonly deps: CliLoginDependencies;

  constructor(deps: CliLoginDependencies) {
    this.deps = deps;
  }

  /** Checks what the browser sent to the confirmation page. */
  begin(challenge: string, machine: string): void {
    if (!CHALLENGE.test(challenge))
      throw invalid('identity.challenge', 'the PKCE challenge is not valid');
    if (machine.trim() === '') throw invalid('identity.machine', 'the machine name is empty');
  }

  /** The user confirmed: a code that lives 60 seconds and is exchanged once. */
  approve(user: User, challenge: string, machine: string): { code: string; expiresAt: number } {
    this.begin(challenge, machine);
    const code = this.deps.random.token(32);
    const now = this.deps.clock.now();
    const expiresAt = now + CLI_CODE_TTL;
    this.deps.codes.insert(
      hashSecret(code),
      { userId: user.id, challenge, machine: machine.trim(), expiresAt },
      now,
    );
    return { code, expiresAt };
  }

  /** Exchanges the code for a token `cli <machine>`; a wrong verifier, an expired or used code is refused. */
  exchange(code: string, verifier: string): { value: string; user: User } {
    const hash = hashSecret(code);
    const record = this.deps.codes.byHash(hash);
    const now = this.deps.clock.now();
    if (!record)
      throw appError('unauthorized', 'identity.code_unknown', 'the login code is not valid');
    if (record.usedAt !== null || record.expiresAt <= now) {
      throw appError(
        'unauthorized',
        'identity.code_expired',
        'the login code has expired or was used',
      );
    }
    this.deps.codes.markUsed(hash, now);
    if (pkceChallenge(verifier) !== record.challenge) {
      throw appError('unauthorized', 'identity.code_verifier', 'the PKCE verifier does not match');
    }
    const user = this.deps.users.byId(record.userId);
    if (!user || user.disabled) {
      throw appError('unauthorized', 'identity.user_disabled', 'the account is disabled');
    }
    const { value } = this.deps.tokens.create(user.id, `cli ${record.machine}`, null);
    return { value, user };
  }
}
