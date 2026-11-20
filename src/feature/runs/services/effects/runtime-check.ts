import { findExecutable } from '../../../../platform/process/index.ts';
import type { Runtime as RuntimeName } from '../../../swarm-config/types/index.ts';
import type { ProcessExit } from '../../../agents/services/index.ts';
import type { NetworkMonitor } from '../../../network/services/index.ts';
import { findGroup, type FailReason, type RunState } from '../../types/index.ts';

import type { AttemptKey, EffectDependencies } from './context.ts';

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

/** The environment of an agent with `network.proxy`; `runtimes.<runtime>.env` still wins over it. */
export function withProxy(environment: NodeJS.ProcessEnv, proxy: string | null): NodeJS.ProcessEnv {
  return proxy === null ? environment : { ...environment, HTTPS_PROXY: proxy, HTTP_PROXY: proxy };
}

/**
 * Why an agent that ended without a report may have ended because of the network: the problem,
 * or null. The check runs after the exit and outside the queue, so a slow probe holds nothing.
 */
export async function networkFailure(
  network: Pick<NetworkMonitor, 'checkNow'>,
  state: RunState,
  key: AttemptKey,
  exit: ProcessExit,
): Promise<string | null> {
  if (exit.spawnError || exit.outcome.usageLimit) return null;
  const attempt = findGroup(state, key.group)?.attempts.find((item) => item.seq === key.seq);
  if (!attempt || attempt.status !== 'running' || attempt.reason !== null) return null;
  if (attempt.report !== null) return null;
  if (exit.outcome.networkError) return exit.outcome.networkError;
  let snapshot;
  try {
    snapshot = await network.checkNow();
  } catch {
    return null;
  }
  return snapshot.state === 'down' ? (snapshot.problem ?? 'network is down') : null;
}
