import { createIdentityServices } from '../feature/identity/services/index.ts';
import { actorOf, type Actor } from '../feature/identity/types/index.ts';
import { defaultServer } from '../feature/swarm-config/types/index.ts';
import type { ConfigService } from '../feature/swarm-config/services/index.ts';
import { appError } from '../platform/errors/index.ts';
import type { Database } from '../platform/sqlite/index.ts';

interface ActorOptions {
  database: Database;
  config: ConfigService;
  now: () => number;
}

/** The identity services and the actor of a request: `local` without server mode, else a user or `system`. */
export function createActors({ database, config, now }: ActorOptions) {
  const serverSettings = () => {
    const settings = config.serverSettings();
    return typeof settings === 'string' ? defaultServer() : settings;
  };
  const identity = createIdentityServices({ database, settings: serverSettings, clock: { now } });
  /** `local` without server mode; with it `system` for the socket and the user the panel named. */
  const actorOfRequest = (actorId: string | undefined): Actor => {
    if (!serverSettings().enabled) return { kind: 'local' };
    if (actorId === undefined) return { kind: 'system' };
    const user = identity.users.byId(actorId);
    if (!user || user.disabled) {
      throw appError('unauthorized', 'auth.unauthorized', 'unknown or disabled user');
    }
    return actorOf(user);
  };
  return { identity, actorOfRequest };
}
