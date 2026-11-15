import {
  type DispatchLimit,
  type Group,
  type GroupWait,
  type RunState,
  actionOf,
  actionPointOf,
  allGroups,
  isRepairGroup,
  REPOSITORY_LIMIT,
  attemptSeed,
  poolOf,
  runningByPool,
  type PoolSlot,
  type SelectedRuntime,
  limitHolds,
  networkRetryAt,
  openAction,
  pointClosed,
  repositoryLimits,
  runningByRepository,
  runningBySpecialist,
  selectAttemptRuntime,
  specialistName,
  specialistOfStep,
  stepsOf,
} from '../types/index.ts';
import type { Specialist } from '../../swarm-config/types/index.ts';
import { OFF_NETWORK, type NetworkSnapshot } from '../../network/types/index.ts';

export interface DispatchPlan {
  /** Groups the scheduler starts now, in start order. */
  start: { state: RunState; group: Group; selected?: SelectedRuntime }[];
  /** Queued groups that stay queued, keyed by `waitKey(run, slug)`. */
  waits: Map<string, GroupWait>;
}

export function waitKey(run: string, slug: string): string {
  return `${run}/${slug}`;
}

function isDeliveryGroup(state: RunState, group: Group): boolean {
  const point = actionPointOf(group);
  if (point !== undefined) return point === 'before_delivery' || point === 'after_delivery';
  return group === state.message || group === state.resolve;
}

/** A command action runs a shell command: no specialist, no limits of the swarm. */
export function isCommandAction(state: RunState, group: Group): boolean {
  const action = actionOf(state.run, group);
  return action !== undefined && action.run !== null;
}

/** The pipeline has not reached the group yet: an action before it is not settled. */
function gated(state: RunState, group: Group): boolean {
  const point = actionPointOf(group);
  // A check shares the tree of the run with the merges: it starts on a tree no merge is changing.
  if (point === 'before_delivery' && state.groups.some((other) => other.mergeInFlight)) return true;
  if (point !== undefined) return openAction(state, point) !== group;
  if (group === state.split) return !pointClosed(state, 'before_split');
  if (state.groups.includes(group)) return !pointClosed(state, 'after_split');
  return false;
}

/** An agent starts neither during the pause after a network failure nor while the network is down. */
function networkWaitOf(group: Group, now: number, network: NetworkSnapshot): GroupWait | null {
  const retryAt = networkRetryAt(group);
  if (retryAt !== null && retryAt > now) {
    const failure = group.attempts.at(-1)?.reason;
    const problem = network.problem ?? (failure?.kind === 'network' ? failure.problem : 'network');
    return { reason: 'network', problem, until: retryAt };
  }
  if (network.state !== 'down') return null;
  return { reason: 'network', problem: network.problem ?? 'network is down', until: null };
}

/** What is running now, and what the groups accepted in this pass add to it. */
interface Counters {
  machine: number;
  repository: Map<string, number>;
  specialist: Map<string, number>;
  pool: Map<string, number>;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** The runtime and model the next attempt of the group would start with. */
function plannedRuntime(
  state: RunState,
  group: Group,
  specialist: Specialist,
  stepId: string,
  holds: Map<string, number>,
): SelectedRuntime {
  const stepIndex = group.pending?.stepIndex ?? 0;
  const seq = (group.attempts.at(-1)?.seq ?? 0) + 1;
  return selectAttemptRuntime({
    specialist,
    chains: state.run.config.chains,
    defaults: state.run.config.defaults,
    limitHolds: holds,
    attempts: group.attempts,
    stepIndex,
    round: group.attempts.filter((a) => a.stepIndex === stepIndex).length + 1,
    resume: group.pending?.resume ?? false,
    keepRuntime: group.pending?.keepRuntime ?? false,
    seed: attemptSeed(state.run.id, group.slug, stepId, seq),
  });
}

/** The one limit of the machine, the pool or the repository that holds the candidate; null when none. */
function capacityWaitOf(
  repository: string,
  pool: PoolSlot | null,
  counters: Counters,
  limit: DispatchLimit,
  repositoryMax: number,
): GroupWait | null {
  if (pool && (counters.pool.get(pool.key) ?? 0) >= pool.max) {
    return { reason: 'pool', pool: pool.name, max: pool.max };
  }
  if (counters.machine >= limit.max) {
    return { reason: 'capacity', scope: 'machine', max: limit.max };
  }
  if (limit.kind === 'repository' && (counters.repository.get(repository) ?? 0) >= repositoryMax) {
    return { reason: 'capacity', scope: 'repository', max: repositoryMax };
  }
  return null;
}

/** The groups ready to start in the order of the queue: the older run first, then by position. */
function queuedGroups(states: RunState[]): { state: RunState; group: Group }[] {
  return states
    .filter((state) => state.run.finishedAt === null)
    .sort(
      (left, right) =>
        left.run.createdAt - right.run.createdAt || left.run.id.localeCompare(right.run.id, 'en'),
    )
    .flatMap((state) =>
      [...allGroups(state)]
        .sort((left, right) => left.position - right.position)
        // A held run starts no worker groups, no split step and no preparing action; delivery groups still run.
        .filter((group) => state.run.hold === null || isDeliveryGroup(state, group))
        .filter((group) => group.status === 'queued' && group.pending !== null)
        .filter((group) => !gated(state, group))
        .map((group) => ({ state, group })),
    );
}

/**
 * Decides which queued groups start and which wait, without changing any state.
 * `dispatchLimit.max` (`queue.max`) limits the running agent attempts of the machine in both modes;
 * with `kind: repository`, `swarm.max` also limits those of each repository; pools limit the attempts
 * of their runtimes and models. A specialist's `max` counts its slug across all runs. Repair attempts
 * count like the others and wait for all of them but a usage limit; shell commands count for none.
 */
export function planDispatch(
  states: RunState[],
  now: number,
  network: NetworkSnapshot = OFF_NETWORK,
  dispatchLimit: DispatchLimit = REPOSITORY_LIMIT,
): DispatchPlan {
  const start: DispatchPlan['start'] = [];
  const waits = new Map<string, GroupWait>();
  const repository = runningByRepository(states);
  const counters: Counters = {
    machine: [...repository.values()].reduce((sum, count) => sum + count, 0),
    repository,
    specialist: runningBySpecialist(states),
    pool: runningByPool(states, dispatchLimit),
  };
  const limits = repositoryLimits(states);
  const holds = limitHolds(states, now);
  const queue = queuedGroups(states);
  for (const { state, group } of queue) {
    if (isCommandAction(state, group)) {
      start.push({ state, group });
      continue;
    }
    const key = waitKey(state.run.id, group.slug);
    const networkWait = networkWaitOf(group, now, network);
    if (networkWait !== null) {
      waits.set(key, networkWait);
      continue;
    }
    const step = group.pending ? stepsOf(state.run, group)[group.pending.stepIndex] : undefined;
    const specialist = step ? specialistOfStep(state.run, group, step) : undefined;
    // The real specialist: for a repair `step.specialist` is only a placeholder.
    const slug = specialist?.slug;
    const selected =
      specialist && step ? plannedRuntime(state, group, specialist, step.id, holds) : undefined;
    const until = selected ? holds.get(selected.runtime) : undefined;
    // A repair ignores the hold of a usage limit: an agent that hits it ends the repair.
    if (selected && until !== undefined && !isRepairGroup(group)) {
      waits.set(key, { reason: 'limit', runtime: selected.runtime, until });
      continue;
    }
    const max = specialist?.max ?? null;
    if (slug && max !== null && (counters.specialist.get(slug) ?? 0) >= max) {
      waits.set(key, {
        reason: 'specialist',
        specialist: slug,
        name: specialistName(state.run.config, slug),
        max,
      });
      continue;
    }
    const pool = selected ? poolOf(dispatchLimit, selected.runtime, selected.model) : null;
    const wait = capacityWaitOf(
      state.run.repository,
      pool,
      counters,
      dispatchLimit,
      limits.get(state.run.repository) ?? state.run.config.max,
    );
    if (wait !== null) {
      // A step without a specialist is a configuration error, not a wait.
      if (specialist) waits.set(key, wait);
      continue;
    }
    start.push(selected ? { state, group, selected } : { state, group });
    if (slug) bump(counters.specialist, slug);
    if (pool) bump(counters.pool, pool.key);
    counters.machine += 1;
    bump(counters.repository, state.run.repository);
  }
  return { start, waits };
}
