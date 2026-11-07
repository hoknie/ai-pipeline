import { join } from 'node:path';

import {
  RUN_WORKTREE,
  attemptDirectory,
  ensureWorktree,
  git,
  runWorktreeRoot,
  workspaceRoot,
} from '../../../../platform/git/index.ts';
import {
  REPAIR_GROUP,
  RESOLVE_GROUP,
  groupRef,
  isRepairGroup,
  isResolveGroup,
  isServiceGroup,
  runRef,
  type Group,
  type RunState,
} from '../../types/index.ts';

/** The directory of the working copies and logs of the run. */
export function workspaceOf(state: RunState): string {
  return workspaceRoot(state.run.repository, state.run.config.workspaceDir);
}

/** The tree the resolver of a delivery conflict works in. */
export function resolveWorktree(state: RunState): string {
  return join(runWorktreeRoot(workspaceOf(state), state.run.id), RESOLVE_GROUP);
}

export function worktreePath(state: RunState, group: Group): string {
  // The repair group is checked first: it is a service group, but it never works in the run tree.
  if (isRepairGroup(group) && state.run.pendingDelivery?.repair) return resolveWorktree(state);
  const name = isRepairGroup(group)
    ? REPAIR_GROUP
    : isResolveGroup(group)
      ? RESOLVE_GROUP
      : isServiceGroup(group)
        ? RUN_WORKTREE
        : group.slug;
  return join(runWorktreeRoot(workspaceOf(state), state.run.id), name);
}

export function logPath(state: RunState, group: string, seq: number): string {
  return join(attemptDirectory(workspaceOf(state), state.run.id, group, seq), 'output.log');
}

/** Creates the tree of the group when it is missing and returns its path. */
export async function ensureGroupWorktree(state: RunState, group: Group): Promise<string> {
  const { repository } = state.run;
  const branch = runRef(state.run);
  const runTree = await ensureWorktree(
    repository,
    join(runWorktreeRoot(workspaceOf(state), state.run.id), RUN_WORKTREE),
    branch,
    null,
  );
  if (isRepairGroup(group)) {
    if (state.run.pendingDelivery?.repair) return worktreePath(state, group);
    return ensureWorktree(repository, worktreePath(state, group), branch, null);
  }
  if (isResolveGroup(group)) return worktreePath(state, group);
  if (isServiceGroup(group)) return runTree;
  return ensureWorktree(
    repository,
    worktreePath(state, group),
    groupRef(state.run, group.slug),
    branch,
  );
}

/** The tree sits on a detached HEAD: a commit of an action moves it, so reset to the ref of the run. */
export async function resetRunTree(state: RunState, tree: string): Promise<void> {
  await git(tree, 'reset', '--hard', runRef(state.run));
  await git(tree, 'clean', '-fd');
}
