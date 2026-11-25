import { conflictsOnBase } from '../../../../platform/git/index.ts';
import type { ProbeCheck, RunState } from '../../types/index.ts';
import { groupChanges } from '../effects/git.ts';

/** The merged groups of a probe run, in the order a delivery would apply them. */
function mergedSlugs(state: RunState): string[] {
  return state.groups
    .filter((group) => group.status === 'merged' && group.mergeCommit !== null)
    .map((group) => group.slug);
}

/**
 * Whether the result of a probe run would deliver cleanly on the base commit: the changes are
 * applied in a temporary index only, so a probe never reaches the worktree of the user. A git
 * failure is thrown instead of reported as a conflict: a probe that cannot be checked decides
 * nothing, and the caller excludes it from the comparison.
 */
export const probeCheck: ProbeCheck = async (state: RunState) => {
  const slugs = mergedSlugs(state);
  if (slugs.length === 0) return { applied: false, conflicts: [] };
  const conflicts = await conflictsOnBase(
    state.run.repository,
    state.run.baseCommit,
    groupChanges(state, slugs),
  );
  return { applied: conflicts.length === 0, conflicts };
};
