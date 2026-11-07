import type { Attempt } from './attempt.ts';
import { COMMAND_RUNTIME, USAGE_LIMIT_FALLBACK_MS } from './constants.ts';
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
