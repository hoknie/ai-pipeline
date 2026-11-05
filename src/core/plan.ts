import { findSpecialist } from '../config/index.ts';

import { allGroups, stepsOf, type Group, type RunState } from './model.ts';
import { specialistName } from './topology.ts';
import {
  limitHolds,
  repositoryLimits,
  runningByRepository,
  runningBySpecialist,
} from './scheduler.ts';

/** Why a queued group is not started yet. */
export type GroupWait =
  | { reason: 'limit'; runtime: string; until: number }
  | { reason: 'specialist'; specialist: string; name: string; max: number }
  | { reason: 'capacity'; max: number };

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
  return group === state.message || group === state.resolve;
}

/**
 * Decides which queued groups start and which wait, without changing any state.
 * `swarm.max` limits the running specialists of each repository separately; a specialist's
 * `max` counts its slug across all runs.
 */
export function planDispatch(states: RunState[], now: number): DispatchPlan {
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
        left.run.createdAt - right.run.createdAt || left.run.id.localeCompare(right.run.id),
    )
    .flatMap((state) =>
      [...allGroups(state)]
        .sort((left, right) => left.position - right.position)
        // A held run starts no worker groups and no split step; delivery groups still run.
        .filter((group) => state.run.hold === null || isDeliveryGroup(state, group))
        .filter((group) => group.status === 'queued' && group.pending !== null)
        .map((group) => ({ state, group })),
    );
  for (const { state, group } of queue) {
    const slug = group.pending
      ? stepsOf(state.run, group)[group.pending.stepIndex]?.specialist
      : undefined;
    const specialist = slug ? findSpecialist(state.run.config, slug) : undefined;
    const key = waitKey(state.run.id, group.slug);
    const until = specialist ? holds.get(specialist.runtime) : undefined;
    if (specialist && until !== undefined) {
      waits.set(key, { reason: 'limit', runtime: specialist.runtime, until });
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
