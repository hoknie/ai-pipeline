import type { Defaults, RuntimeChain, Specialist } from '../../swarm-config/types/index.ts';
import type { Attempt } from './attempt.ts';
import { type SelectedRuntime, holdKey, pickChainItem } from './chains/chain-select.ts';
import { COMMAND_RUNTIME, USAGE_LIMIT_FALLBACK_MS, type AttemptRuntime } from './constants.ts';
import { NETWORK_RETRY_MS } from '../../network/types/index.ts';
import { type Group } from './group.ts';
import type { PoolConfig } from './pools/pools.ts';
import { type RunState, allGroups } from './run.ts';

/** When the usage limit of an attempt that ran out of it resets; null for other attempts. */
export function limitResetsAt(attempt: Attempt): number | null {
  if (attempt.reason?.kind !== 'usage_limit') return null;
  return (
    attempt.reason.resetsAt ?? (attempt.finishedAt ?? attempt.startedAt) + USAGE_LIMIT_FALLBACK_MS
  );
}

/** When the group may retry after a network failure of its last attempt; null otherwise. */
export function networkRetryAt(group: Group): number | null {
  const last = group.attempts.at(-1);
  if (last?.reason?.kind !== 'network' || last.status !== 'failed') return null;
  return (last.finishedAt ?? last.startedAt) + NETWORK_RETRY_MS;
}

/** Hold keys (`holdKey`: provider or runtime) of usage limits that have not reset at `now`, with the moment each resets. */
export function limitHolds(states: Iterable<RunState>, now: number): Map<string, number> {
  const holds = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        const until = limitResetsAt(attempt);
        if (until === null || until <= now) continue;
        const key = holdKey(attempt.runtime, attempt.provider);
        holds.set(key, Math.max(holds.get(key) ?? 0, until));
      }
    }
  }
  return holds;
}

/**
 * What caps the agent attempts that work at once: `max` of the machine (`queue.max`) in both queue
 * modes, `swarm.max` of each repository in `repository` (the project mode), and the quotas of the pools.
 */
export interface DispatchLimit extends PoolConfig {
  kind: 'repository' | 'machine';
  max: number;
}

/** No limit of the machine and no pools: only `swarm.max` of each repository. */
export const REPOSITORY_LIMIT: DispatchLimit = {
  kind: 'repository',
  max: Number.POSITIVE_INFINITY,
  pools: [],
  defaultPool: null,
};

/** Running agent attempts of each repository, repair included. */
export function runningByRepository(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    const running = allGroups(state).reduce(
      (count, group) =>
        count +
        group.attempts.filter(
          (attempt) => attempt.status === 'running' && attempt.runtime !== COMMAND_RUNTIME,
        ).length,
      0,
    );
    counts.set(state.run.repository, (counts.get(state.run.repository) ?? 0) + running);
  }
  return counts;
}

/** `swarm.max` of each repository: the value of its most recently created run. */
export function repositoryLimits(states: RunState[]): Map<string, number> {
  const latest = new Map<string, RunState>();
  for (const state of states) {
    const current = latest.get(state.run.repository);
    if (
      !current ||
      state.run.createdAt > current.run.createdAt ||
      (state.run.createdAt === current.run.createdAt && state.run.id > current.run.id)
    )
      latest.set(state.run.repository, state);
  }
  return new Map([...latest].map(([repository, state]) => [repository, state.run.config.max]));
}

export function runningBySpecialist(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        if (attempt.status !== 'running' || attempt.runtime === COMMAND_RUNTIME) continue;
        counts.set(attempt.specialist, (counts.get(attempt.specialist) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Why a queued group is not started yet. */
export type GroupWait =
  | { reason: 'limit'; runtime: string; provider?: string; providerName?: string; until: number }
  | { reason: 'specialist'; specialist: string; name: string; max: number }
  | { reason: 'pool'; pool: string; max: number }
  /** `machine`: `queue.max` is taken; `repository`: `swarm.max` of the project mode. */
  | { reason: 'capacity'; scope: 'machine' | 'repository'; max: number }
  /** The network is down (`until` null) or the last attempt failed because of it (`until`: retry). */
  | { reason: 'network'; problem: string; until: number | null };

export interface SelectAttemptOptions {
  specialist: Specialist;
  chains: RuntimeChain[];
  defaults: Defaults;
  limitHolds: Map<string, number>;
  attempts: Attempt[];
  stepIndex: number;
  round: number;
  resume: boolean;
  /** The attempt before it failed because of the network: keep its runtime even without a session. */
  keepRuntime?: boolean;
  /** The provider of the run: candidates of every chain mode are then its enabled items only. */
  provider?: string | null;
  seed?: number;
}

export function selectAttemptRuntime(options: SelectAttemptOptions): SelectedRuntime | null {
  const { specialist, chains, defaults, limitHolds, attempts, stepIndex, resume, seed } = options;
  const keepRuntime = options.keepRuntime ?? false;
  if (!specialist.runtimeChain) {
    return {
      runtime: specialist.runtime,
      model: specialist.model,
      ...(specialist.variant !== undefined ? { variant: specialist.variant } : {}),
      ...(specialist.reasoningEffort !== undefined
        ? { reasoningEffort: specialist.reasoningEffort }
        : {}),
    };
  }
  // A resumed attempt keeps its runtime and model even when the chain is off or has no items, but
  // only while it belongs to the provider of the run.
  if (resume || keepRuntime) {
    const prev = [...attempts].reverse().find((a) => a.stepIndex === stepIndex);
    if (prev && (options.provider == null || prev.provider === options.provider)) {
      return {
        runtime: prev.runtime,
        model: prev.model,
        ...(prev.variant !== undefined ? { variant: prev.variant } : {}),
        ...(prev.reasoningEffort !== undefined ? { reasoningEffort: prev.reasoningEffort } : {}),
        ...(prev.chainIndex !== undefined && prev.chainIndex !== null
          ? { chainIndex: prev.chainIndex }
          : {}),
        ...(prev.provider !== undefined ? { provider: prev.provider } : {}),
      };
    }
  }
  const chain = chains.find((c) => c.slug === specialist.runtimeChain);
  if (!chain || !chain.enabled) {
    return { runtime: defaults.runtime, model: null };
  }
  const enabledItems = chain.runtimes
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.enabled);
  if (enabledItems.length === 0) {
    return { runtime: defaults.runtime, model: null };
  }
  const candidates =
    options.provider == null
      ? enabledItems
      : enabledItems.filter(({ item }) => item.provider === options.provider);
  if (candidates.length === 0) return null;
  return pickChainItem(
    chain.mode,
    candidates,
    limitHolds,
    attempts,
    specialist.slug,
    stepIndex,
    seed,
  );
}
