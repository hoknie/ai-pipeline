import {
  allGroups,
  GROUP_STATUSES,
  addUsage,
  groupUsage,
  isRunFinished,
  runPhase,
  type GroupStatus,
  type RunPhase,
  type RunState,
  type Usage,
} from './model.ts';

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
  let usage: Usage | null = null;
  for (const group of state.groups) {
    counts[group.status] += 1;
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

export function formatCounts(summary: RunSummary): string {
  return GROUP_STATUSES.filter((status) => summary.counts[status] > 0)
    .map((status) => `${status} ${summary.counts[status]}`)
    .join(' · ');
}
