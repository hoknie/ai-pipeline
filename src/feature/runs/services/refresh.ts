import { rejected } from '../../../platform/errors/index.ts';
import {
  permissionsOf,
  specialistsOf,
  type PermissionsRefresh,
  type SpecialistsRefresh,
} from '../../agents/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ResolvedConfig,
  applyVariant,
  checkVariant,
  firstConfigError,
  providerProblem,
} from '../../swarm-config/types/index.ts';
import type { Event } from '../machine/index.ts';
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

/**
 * The current configuration of the run's repository with the variant applied (the skips are not):
 * the machine takes the definitions of the steps from it. A configuration that does not load or a
 * variant the pipeline does not have refuses the request.
 */
export function variantConfig(
  config: ConfigService,
  state: RunState,
  variant: string,
): ResolvedConfig {
  let current: ResolvedConfig;
  try {
    current = config.load(state.run.repository);
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) throw rejected((error as Error).message);
    throw rejected(`configuration not loaded: ${firstConfigError(error)}`);
  }
  const problem = checkVariant(current, state.run.pipeline, variant);
  if (problem !== null) throw rejected(problem);
  return applyVariant(current, state.run.pipeline, variant);
}

/**
 * The event that gives the run another provider (null: none). The provider must be known to the
 * current configuration of the run's repository, which must load; the run keeps its own provider
 * when the request names it again.
 */
export function providerEvent(
  config: ConfigService,
  state: RunState,
  provider: string | null,
): Event {
  let current: ResolvedConfig;
  try {
    current = config.load(state.run.repository);
  } catch (error) {
    if (!(error instanceof ConfigLoadError)) throw rejected((error as Error).message);
    throw rejected(`configuration not loaded: ${firstConfigError(error)}`);
  }
  if (provider !== null && provider !== state.run.provider) {
    const problem = providerProblem(current, provider);
    if (problem !== null) throw rejected(problem);
  }
  return { kind: 'provider_set', provider };
}
