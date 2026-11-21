import {
  cleanRun as cleanWorkspace,
  runWorktreeRoot,
  workspaceRoot,
  type CleanPlan,
} from '../../../../platform/git/index.ts';
import { deliveryBranch, groupRef, isRunFinished, type RunState } from '../../types/index.ts';

/**
 * What a cleanup of the run removes, for both formats of refs. `all` also removes the visible
 * branch `aip/<run>`.
 */
export function cleanPlanOf(state: RunState, all: boolean): CleanPlan {
  const { run } = state;
  const workspace = workspaceRoot(run.repository, run.config.workspaceDir);
  const refs = run.refStyle === 'refs';
  return {
    repository: run.repository,
    root: runWorktreeRoot(workspace, run.id),
    runBranch: refs ? deliveryBranch(run) : run.branch,
    groupBranches: refs ? [] : state.groups.map((group) => groupRef(run, group.slug)),
    refPrefix: refs ? `refs/aip/${run.id}/` : null,
    all,
    active: !isRunFinished(state),
  };
}

/** Removes the worktrees, service refs and group branches of the plan; returns what went away. */
export function removeRunFiles(state: RunState, all: boolean): Promise<string[]> {
  return cleanWorkspace(cleanPlanOf(state, all));
}
