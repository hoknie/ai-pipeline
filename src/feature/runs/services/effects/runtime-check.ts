import { findExecutable } from '../../../../platform/process/index.ts';
import type { Runtime as RuntimeName } from '../../../swarm-config/types/index.ts';
import type { FailReason } from '../../types/index.ts';

import type { EffectDependencies } from './context.ts';

/**
 * Why a runtime cannot start an agent in a repository by its current settings, or null when it
 * can: the settings are unreadable (`spawn`), the runtime is off (`runtime_disabled`) or its
 * command is not found (`runtime_not_found`).
 */
export function runtimeProblem(
  dependencies: Pick<EffectDependencies, 'config' | 'agents' | 'environment'>,
  repository: string,
  name: string,
): FailReason | null {
  const runtime = name as RuntimeName;
  const { config, agents, environment } = dependencies;
  const settings = config.runtimeSettings(repository);
  if (typeof settings === 'string') return { kind: 'spawn', message: settings };
  if (!agents.isEnabled(runtime, settings)) return { kind: 'runtime_disabled', runtime };
  if (!findExecutable(agents.runtimeFor(runtime, settings).executable, environment.PATH)) {
    return { kind: 'runtime_not_found', runtime };
  }
  return null;
}
