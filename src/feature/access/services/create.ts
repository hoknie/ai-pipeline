import type { UsersService } from '../../identity/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { AccessRole } from '../../swarm-config/types/index.ts';
import {
  ACCESS_RELOAD_MS,
  AccessPolicySource,
  type ConfigService,
} from '../../swarm-config/services/index.ts';
import { actionNames, similarActions } from '../types/index.ts';
import { AccessService } from './access.ts';

export interface AccessServices {
  access: AccessService;
}

export function createAccessServices(dependencies: {
  config: ConfigService;
  registry: RegistryService;
  users: Pick<UsersService, 'list'>;
  now: () => number;
  log: (message: string) => void;
}): AccessServices {
  const { config, registry, users, now, log } = dependencies;
  const source = new AccessPolicySource({
    paths: () => config.pathsOf('.'),
    catalog: { names: actionNames(), similar: (name) => similarActions(name) },
    now,
    log,
  });
  let role: { at: number; value: AccessRole | null } = {
    at: Number.NEGATIVE_INFINITY,
    value: null,
  };
  const access = new AccessService({
    policy: () => source.current(),
    defaultRole: () => {
      // `settings.yaml` is read from disk: once in the reload period is enough for a decision
      if (now() - role.at >= ACCESS_RELOAD_MS) {
        const settings = config.serverSettings();
        role = { at: now(), value: typeof settings === 'string' ? null : settings.defaultRole };
      }
      return role.value;
    },
    registry,
    users,
  });
  return { access };
}
