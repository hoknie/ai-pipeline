import {
  type Group,
  type GroupWait,
  type RunState,
  actionOf,
  actionPointOf,
  allGroups,
  isRepairGroup,
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
  start: { state: RunState; group: Group }[];
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

/** The runtime the next attempt of the group would run on. */
function plannedRuntime(
  state: RunState,
  group: Group,
  specialist: Specialist,
  holds: Map<string, number>,
): string {
  const stepIndex = group.pending?.stepIndex ?? 0;
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
  }).runtime;
}

/**
 * Decides which queued groups start and which wait, without changing any state.
 * `swarm.max` limits the running specialists of each repository separately; a specialist's
 * `max` counts its slug across all runs.
 */
export function planDispatch(
  states: RunState[],
  now: number,
  network: NetworkSnapshot = OFF_NETWORK,
): DispatchPlan {
  const start: DispatchPlan['start'] = [];
  const waits = new Map<string, GroupWait>();
  const running = runningByRepository(states);
  const limits = repositoryLimits(states);
  const bySpecialist = runningBySpecialist(states);
  const holds = limitHolds(states, now);
  const queue = states
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
    const slug = group.pending
      ? stepsOf(state.run, group)[group.pending.stepIndex]?.specialist
      : undefined;
    const specialist = slug ? specialistOfStep(state.run, group, slug) : undefined;
    // The repair waits for no limit here: an agent that hits one ends the repair.
    if (isRepairGroup(group)) {
      start.push({ state, group });
      continue;
    }
    const effectiveRuntime = specialist
      ? plannedRuntime(state, group, specialist, holds)
      : undefined;
    const until = effectiveRuntime ? holds.get(effectiveRuntime) : undefined;
    if (effectiveRuntime && until !== undefined) {
      waits.set(key, { reason: 'limit', runtime: effectiveRuntime, until });
      continue;
    }
    const limit = specialist?.max ?? null;
    if (slug && limit !== null && (bySpecialist.get(slug) ?? 0) >= limit) {
      waits.set(key, {
        reason: 'specialist',
        specialist: slug,
        name: specialistName(state.run.config, slug),
        max: limit,
      });
      continue;
    }
    const repository = state.run.repository;
    const max = limits.get(repository) ?? state.run.config.max;
    if ((running.get(repository) ?? 0) >= max) {
      // A step without a specialist is a configuration error, not a wait.
      if (specialist) waits.set(key, { reason: 'capacity', max });
      continue;
    }
    start.push({ state, group });
    if (slug) bySpecialist.set(slug, (bySpecialist.get(slug) ?? 0) + 1);
    running.set(repository, (running.get(repository) ?? 0) + 1);
  }
  return { start, waits };
}
