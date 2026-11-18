import type { Database } from '../../../platform/sqlite/index.ts';
import type { ServerSettings } from '../../swarm-config/types/index.ts';
import type { Clock, Random } from '../ports/index.ts';
import {
  CliCodesRepository,
  LoginLinksRepository,
  SessionsRepository,
  TokensRepository,
  UsersRepository,
} from '../repositories/index.ts';

import { CliLoginService } from './cli-login.ts';
import { SessionsService } from './sessions.ts';
import { systemClock, systemRandom } from './system.ts';
import { TokensService } from './tokens.ts';
import { UsersService } from './users.ts';

export interface IdentityServices {
  users: UsersService;
  sessions: SessionsService;
  tokens: TokensService;
  cliLogin: CliLoginService;
}

export function createIdentityServices(dependencies: {
  database: Database;
  settings: () => ServerSettings;
  clock?: Clock;
  random?: Random;
}): IdentityServices {
  const { database, settings } = dependencies;
  const clock = dependencies.clock ?? systemClock;
  const random = dependencies.random ?? systemRandom;
  const usersRepository = new UsersRepository(database);
  const sessionsRepository = new SessionsRepository(database);
  const tokensRepository = new TokensRepository(database);
  const users = new UsersService({
    database,
    users: usersRepository,
    sessions: sessionsRepository,
    tokens: tokensRepository,
    clock,
    random,
  });
  const tokens = new TokensService({ tokens: tokensRepository, users, settings, clock, random });
  return {
    users,
    tokens,
    sessions: new SessionsService({
      database,
      users,
      sessions: sessionsRepository,
      links: new LoginLinksRepository(database),
      settings,
      clock,
      random,
    }),
    cliLogin: new CliLoginService({
      codes: new CliCodesRepository(database),
      users,
      tokens,
      clock,
      random,
    }),
  };
}
