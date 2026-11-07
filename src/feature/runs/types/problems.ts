import { isRepairGroup } from './group.ts';
import { type RunState, actionClosed, allGroups, isRunFinished, stoppedActions } from './run.ts';

export type RunPhase = 'needs_human' | 'active' | 'finished' | 'cancelled' | 'failed';

/**
 * For a finished run: `cancelled` when the split or any work group was cancelled; otherwise
 * `failed` when the split or a work group failed, or a merged group's delivery is `apply_failed`;
 * otherwise `finished`. Delivery groups (message, resolve) do not count.
 */
export function runPhase(state: RunState): RunPhase {
  if (!isRunFinished(state)) {
    return allGroups(state).some((group) => group.status === 'needs_human')
      ? 'needs_human'
      : 'active';
  }
  const cancelled =
    state.split?.status === 'cancelled' ||
    state.groups.some((group) => group.status === 'cancelled') ||
    stoppedActions(state, 'cancelled').length > 0;
  if (cancelled) return 'cancelled';
  const failed =
    state.split?.status === 'failed' ||
    state.groups.some(
      (group) =>
        group.status === 'failed' ||
        (group.status === 'merged' && group.delivery.state === 'apply_failed'),
    ) ||
    stoppedActions(state, 'failed').length > 0;
  return failed ? 'failed' : 'finished';
}

export type ProblemReason =
  'needs_human' | 'failed' | 'conflict' | 'cancelled' | 'apply_failed' | 'usage_limit';

export interface Problem {
  key: string;
  run: string;
  group: string | null;
  reason: ProblemReason;
}

/**
 * Problems of a run. The key includes the number of attempts, so a problem that
 * comes back after a retry is a new one even if nobody saw the state between.
 */
export function runProblems(state: RunState): Problem[] {
  const id = state.run.id;
  const problems: Problem[] = [];
  const work = [
    ...(state.split ? [state.split, ...state.groups] : state.groups),
    // A failure that the pipeline goes on after is not a problem.
    ...state.actions.filter(
      (group) => group.status === 'needs_human' || !actionClosed(state.run, group),
    ),
  ];
  for (const group of work) {
    const attempts = group.attempts.length;
    if (
      group.status === 'needs_human' ||
      group.status === 'failed' ||
      group.status === 'conflict'
    ) {
      const reason: ProblemReason =
        group.status === 'failed' && group.attempts.at(-1)?.reason?.kind === 'usage_limit'
          ? 'usage_limit'
          : group.status;
      problems.push({
        key: `${id}/${group.slug}/${reason}/${attempts}`,
        run: id,
        group: group.slug,
        reason,
      });
    }
    if (group.status === 'merged' && group.delivery.state === 'apply_failed') {
      problems.push({
        key: `${id}/${group.slug}/apply_failed/${attempts}`,
        run: id,
        group: group.slug,
        reason: 'apply_failed',
      });
    }
  }
  if (runPhase(state) === 'cancelled') {
    const total = allGroups(state)
      .filter((group) => !isRepairGroup(group))
      .reduce((sum, group) => sum + group.attempts.length, 0);
    problems.push({
      key: `${id}/run/cancelled/${total}`,
      run: id,
      group: null,
      reason: 'cancelled',
    });
  }
  return problems;
}
