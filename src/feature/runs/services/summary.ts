import { type Usage, addUsage } from '../../agents/types/index.ts';
import {
  type GroupStatus,
  type RunPhase,
  type RunState,
  GROUP_STATUSES,
  allGroups,
  groupUsage,
  isRunFinished,
  runPhase,
} from '../types/index.ts';

export interface RunSummary {
  counts: Record<GroupStatus, number>;
  total: number;
  finished: boolean;
  state: RunPhase;
  /** Groups (including split, message and resolve) waiting for a human answer. */
  waiting: number;
  usage: Usage | null;
}

export function summarize(state: RunState): RunSummary {
  const counts = Object.fromEntries(GROUP_STATUSES.map((status) => [status, 0])) as Record<
    GroupStatus,
    number
  >;
  for (const group of state.groups) {
    counts[group.status] += 1;
  }
  let usage: Usage | null = null;
  for (const group of allGroups(state)) {
    usage = addUsage(usage, groupUsage(group));
  }
  usage = addUsage(usage, state.run.namingUsage ?? null);
  return {
    counts,
    total: state.groups.length,
    finished: isRunFinished(state),
    state: runPhase(state),
    waiting: allGroups(state).filter((group) => group.status === 'needs_human').length,
    usage,
  };
}

/** When the run was taken into work: the earliest attempt start of any group; null before that. */
export function runStartedAt(state: RunState): number | null {
  let earliest: number | null = null;
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      if (earliest === null || attempt.startedAt < earliest) earliest = attempt.startedAt;
    }
  }
  return earliest;
}

export function formatCounts(summary: RunSummary): string {
  return GROUP_STATUSES.filter((status) => summary.counts[status] > 0)
    .map((status) => `${status} ${summary.counts[status]}`)
    .join(' · ');
}
