import type { Database } from '../../../platform/sqlite/index.ts';
import type { ServerSettings } from '../../swarm-config/types/index.ts';
import type {
  Clock,
  OidcProvider,
  Random,
  SamlAssertionStore,
  SamlProvider,
} from '../ports/index.ts';
import {
  CliCodesRepository,
  SamlAssertionsRepository,
  LoginLinksRepository,
  SessionsRepository,
  SsoRequestsRepository,
  TokensRepository,
  UsersRepository,
} from '../repositories/index.ts';

import { CliLoginService } from './cli-login.ts';
import { SamlLoginService } from './saml.ts';
import { SessionsService } from './sessions.ts';
import { SsoAccounts } from './sso-accounts.ts';
import { SsoLoginService } from './sso.ts';
import { systemClock, systemRandom } from './system.ts';
import { TokensService } from './tokens.ts';
import { UsersService } from './users.ts';

export interface IdentityServices {
  users: UsersService;
  sessions: SessionsService;
  tokens: TokensService;
  cliLogin: CliLoginService;
  sso: SsoLoginService;
  saml: SamlLoginService;
  /** The accepted SAML assertions, for the SAML adapter. */
  samlAssertions: SamlAssertionStore;
}

export function createIdentityServices(dependencies: {
  database: Database;
  settings: () => ServerSettings;
  clock?: Clock;
  random?: Random;
  /** The OpenID Connect adapter; `null` or absent while it cannot be used. */
  oidc?: () => OidcProvider | null;
  /** The SAML adapter; `null` or absent while it cannot be used. */
  saml?: () => SamlProvider | null;
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
  const sessions = new SessionsService({
    database,
    users,
    sessions: sessionsRepository,
    links: new LoginLinksRepository(database),
    settings,
    clock,
    random,
  });
  const accounts = new SsoAccounts({ users: usersRepository, clock, random });
  const requests = new SsoRequestsRepository(database);
  const assertions = new SamlAssertionsRepository(database);
  return {
    users,
    tokens,
    samlAssertions: {
      remember: (id, expiresAt) => assertions.remember(id, expiresAt, clock.now()),
    },
    sessions,
    sso: new SsoLoginService({
      database,
      users: usersRepository,
      requests,
      sessions,
      accounts,
      settings,
      provider: dependencies.oidc ?? (() => null),
      clock,
      random,
    }),
    saml: new SamlLoginService({
      database,
      users: usersRepository,
      requests,
      sessions,
      accounts,
      settings,
      provider: dependencies.saml ?? (() => null),
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
