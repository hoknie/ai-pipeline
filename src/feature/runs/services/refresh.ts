import { rejected } from '../../../platform/errors/index.ts';
import {
  permissionsOf,
  specialistsOf,
  type PermissionsRefresh,
  type SpecialistsRefresh,
} from '../../agents/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import { ConfigLoadError, firstConfigError } from '../../swarm-config/types/index.ts';
import type { RunState } from '../types/index.ts';

/**
 * Whole specialists of the current configuration of the run's repository; a configuration that
 * does not load or pass validation refuses the request.
 */
export function currentSpecialists(config: ConfigService, state: RunState): SpecialistsRefresh {
  try {
    return specialistsOf(config.load(state.run.repository));
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) throw rejected((error as Error).message);
    throw rejected(`configuration not loaded: ${firstConfigError(error)}`);
  }
}

/** Permissions of the specialists in the current configuration of the run's repository. */
export function currentPermissions(config: ConfigService, state: RunState): PermissionsRefresh {
  try {
    return permissionsOf(config.load(state.run.repository));
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) return { error: (error as Error).message };
    return { error: firstConfigError(error) };
  }
}
