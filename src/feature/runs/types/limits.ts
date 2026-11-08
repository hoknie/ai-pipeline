import type {
  Defaults,
  ReasoningEffort,
  RuntimeChain,
  Specialist,
} from '../../swarm-config/types/index.ts';
import type { Attempt } from './attempt.ts';
import { COMMAND_RUNTIME, USAGE_LIMIT_FALLBACK_MS, type AttemptRuntime } from './constants.ts';
import { isRepairGroup } from './group.ts';
import { type RunState, allGroups } from './run.ts';

/** When the usage limit of an attempt that ran out of it resets; null for other attempts. */
export function limitResetsAt(attempt: Attempt): number | null {
  if (attempt.reason?.kind !== 'usage_limit') return null;
  return (
    attempt.reason.resetsAt ?? (attempt.finishedAt ?? attempt.startedAt) + USAGE_LIMIT_FALLBACK_MS
  );
}

/** Runtimes held by a usage limit that has not reset at `now`, with the moment it resets. */
export function limitHolds(states: Iterable<RunState>, now: number): Map<string, number> {
  const holds = new Map<string, number>();
  for (const state of states) {
    for (const group of allGroups(state)) {
      for (const attempt of group.attempts) {
        const until = limitResetsAt(attempt);
        if (until === null || until <= now) continue;
        holds.set(attempt.runtime, Math.max(holds.get(attempt.runtime) ?? 0, until));
      }
    }
  }
  return holds;
}

/** Running attempts of each repository. */
export function runningByRepository(states: RunState[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    const running = allGroups(state).reduce(
      (count, group) =>
        count +
        (isRepairGroup(group) ? [] : group.attempts).filter(
          (attempt) => attempt.status === 'running' && attempt.runtime !== COMMAND_RUNTIME,
        ).length,
      0,
    );
    const repository = state.run.repository;
    counts.set(repository, (counts.get(repository) ?? 0) + running);
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
      if (isRepairGroup(group)) continue;
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
  | { reason: 'limit'; runtime: string; until: number }
  | { reason: 'specialist'; specialist: string; name: string; max: number }
  | { reason: 'capacity'; max: number };

export interface SelectedRuntime {
  runtime: AttemptRuntime;
  model: string | null;
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  chainIndex?: number | null;
}

export interface SelectAttemptOptions {
  specialist: Specialist;
  chains: RuntimeChain[];
  defaults: Defaults;
  limitHolds: Map<string, number>;
  attempts: Attempt[];
  stepIndex: number;
  round: number;
  resume: boolean;
  seed?: number;
}

export function selectAttemptRuntime(options: SelectAttemptOptions): SelectedRuntime {
  const { specialist, chains, defaults, limitHolds, attempts, stepIndex, resume, seed } = options;
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
  if (resume) {
    const prev = [...attempts].reverse().find((a) => a.stepIndex === stepIndex);
    if (prev) {
      return {
        runtime: prev.runtime,
        model: prev.model,
        ...(prev.variant !== undefined ? { variant: prev.variant } : {}),
        ...(prev.reasoningEffort !== undefined ? { reasoningEffort: prev.reasoningEffort } : {}),
        ...(prev.chainIndex !== undefined && prev.chainIndex !== null
          ? { chainIndex: prev.chainIndex }
          : {}),
      };
    }
  }
  return pickChainItem(
    chain.mode,
    enabledItems,
    limitHolds,
    attempts,
    specialist.slug,
    stepIndex,
    seed,
  );
}

function currentStepFailedIndices(attempts: Attempt[], stepIndex: number): Set<number> {
  const failed = new Set<number>();
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]!;
    if (a.stepIndex !== stepIndex || a.status !== 'failed') break;
    if (a.chainIndex !== undefined && a.chainIndex !== null) {
      failed.add(a.chainIndex);
    }
  }
  return failed;
}

function pickChainItem(
  mode: RuntimeChain['mode'],
  enabledItems: { item: RuntimeChain['runtimes'][number]; index: number }[],
  limitHolds: Map<string, number>,
  attempts: Attempt[],
  specialistSlug: string,
  stepIndex: number,
  seed?: number,
): SelectedRuntime {
  if (mode === 'on_error') {
    const failedIndices = currentStepFailedIndices(attempts, stepIndex);
    const candidate = enabledItems.find(
      ({ item, index }) => !failedIndices.has(index) && !limitHolds.has(item.runtime),
    );
    const choice =
      candidate ?? enabledItems.find(({ index }) => !failedIndices.has(index)) ?? enabledItems[0]!;
    return formatSelected(choice);
  }
  const available = enabledItems.filter(({ item }) => !limitHolds.has(item.runtime));
  const pool = available.length > 0 ? available : enabledItems;
  if (mode === 'round_robin') {
    const count = attempts.filter(
      (a) => a.specialist === specialistSlug && a.chainIndex !== null && a.chainIndex !== undefined,
    ).length;
    const choice = pool[count % pool.length]!;
    return formatSelected(choice);
  }
  const pick = seed !== undefined ? Math.abs(seed) % pool.length : 0;
  const choice = pool[pick]!;
  return formatSelected(choice);
}

function formatSelected(entry: {
  item: RuntimeChain['runtimes'][number];
  index: number;
}): SelectedRuntime {
  return {
    runtime: entry.item.runtime,
    model: entry.item.model ?? null,
    ...(entry.item.variant !== undefined ? { variant: entry.item.variant } : {}),
    ...(entry.item.reasoningEffort !== undefined
      ? { reasoningEffort: entry.item.reasoningEffort }
      : {}),
    chainIndex: entry.index,
  };
}

export function hasNextChainItem(
  chain: RuntimeChain | undefined,
  attempts: Attempt[],
  stepIndex: number,
  limitHolds: Map<string, number>,
): boolean {
  if (!chain || !chain.enabled || chain.mode !== 'on_error') return false;
  const enabledItems = chain.runtimes
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.enabled);
  const failedIndices = currentStepFailedIndices(attempts, stepIndex);
  return enabledItems.some(
    ({ item, index }) => !failedIndices.has(index) && !limitHolds.has(item.runtime),
  );
}
