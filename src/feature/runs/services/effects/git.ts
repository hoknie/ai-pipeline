import {
  cleanRun,
  commitAll,
  commitMessage,
  commitResolve,
  deliver,
  filesWithMarkers,
  git,
  mergeBranch,
  prepareResolve,
  runWorktreeRoot,
  updateFromBranch,
  type GroupChange,
} from '../../../../platform/git/index.ts';
import type { DeliveryResult, MergeOutcome } from '../../machine/index.ts';
import {
  RESOLVE_GROUP,
  SPLIT_GROUP,
  actionPointOf,
  deliveryBranch,
  findGroup,
  groupRef,
  runRef,
  type RunState,
} from '../../types/index.ts';

import type { ActionRunner } from './actions.ts';
import type { EffectDependencies } from './context.ts';
import type { OutsideChanges } from './outside.ts';
import { ensureGroupWorktree, resolveWorktree, workspaceOf, worktreePath } from './worktrees.ts';

function groupChanges(state: RunState, slugs: string[]): GroupChange[] {
  return state.groups
    .filter((group) => slugs.includes(group.slug) && group.mergeCommit !== null)
    .sort((left, right) => (left.mergeSeq ?? 0) - (right.mergeSeq ?? 0))
    .map((group) => ({
      group: group.slug,
      from: `${group.mergeCommit}^1`,
      to: group.mergeCommit as string,
    }));
}

function resolveBaseRef(state: RunState): string {
  return `refs/aip/${state.run.id}/resolve-base`;
}

/** The effects of a run on git: commits of steps, merges of groups, delivery and cleanup. */
export class GitEffects {
  private readonly dependencies: EffectDependencies;
  private readonly actions: ActionRunner;
  private readonly outside: OutsideChanges;

  constructor(dependencies: EffectDependencies, actions: ActionRunner, outside: OutsideChanges) {
    this.dependencies = dependencies;
    this.actions = actions;
    this.outside = outside;
  }

  async commit(state: RunState, slug: string, stepId: string, summary: string): Promise<void> {
    const group = findGroup(state, slug);
    if (!group) return;
    try {
      // The actions around the split change the tree of the run itself, which the groups start from.
      const actionPoint = actionPointOf(group);
      await commitAll(
        worktreePath(state, group),
        commitMessage(slug, stepId, summary),
        actionPoint === undefined ? groupRef(state.run, slug) : runRef(state.run),
        state.run.config.workspace.include,
      );
      if (actionPoint === undefined) void this.dependencies.diff.refreshDiff(state, slug);
    } catch (error) {
      await this.dependencies.context.apply(state, {
        kind: 'commit_failed',
        group: slug,
        message: (error as Error).message,
      });
    }
  }

  async merge(state: RunState, slug: string, updateOnConflict: boolean): Promise<void> {
    const group = findGroup(state, slug);
    if (!group) return;
    let outcome: MergeOutcome;
    try {
      const runTree = await ensureGroupWorktree(state, { ...group, slug: SPLIT_GROUP });
      await this.actions.settleChecks(state, runTree);
      const source = groupRef(state.run, slug);
      const target = runRef(state.run);
      const message = `aip: merge ${slug}`;
      const first = await mergeBranch(runTree, source, message, target);
      if (first.kind === 'merged' || !updateOnConflict) outcome = first;
      else {
        const updated = await updateFromBranch(worktreePath(state, group), target, source);
        if (updated.kind === 'conflict')
          outcome = { kind: 'conflict_updated', files: updated.files };
        else outcome = await mergeBranch(runTree, source, message, target);
      }
    } catch (error) {
      outcome = { kind: 'failed', message: (error as Error).message };
    }
    await this.dependencies.context.apply(state, { kind: 'merge_finished', group: slug, outcome });
    void this.dependencies.diff.refreshDiff(state, slug);
    if (outcome.kind === 'merged') void this.dependencies.diff.savePatch(state);
  }

  async prepareResolve(state: RunState, slugs: string[]): Promise<void> {
    try {
      const prepared = await prepareResolve({
        repository: state.run.repository,
        worktree: resolveWorktree(state),
        changes: groupChanges(state, slugs),
        include: state.run.config.workspace.include,
        baseRef: resolveBaseRef(state),
      });
      await this.dependencies.context.apply(state, {
        kind: 'resolve_prepared',
        conflicts: prepared.conflicts,
      });
    } catch (error) {
      const message = `could not prepare the resolver: ${(error as Error).message}`;
      await this.dependencies.context.apply(state, {
        kind: 'delivery_finished',
        result: { kind: 'failed', message },
      });
    }
  }

  async finishResolve(state: RunState, message: string, conflicts: string[]): Promise<void> {
    let result: DeliveryResult;
    try {
      const worktree = resolveWorktree(state);
      const left = filesWithMarkers(worktree, conflicts);
      if (left.length > 0) {
        result = { kind: 'failed', message: `conflict markers remain in: ${left.join(', ')}` };
      } else {
        const { repository } = state.run;
        const { include } = state.run.config.workspace;
        const base = await git(repository, 'rev-parse', resolveBaseRef(state));
        const resolved = await commitResolve(worktree, base, include);
        result = await deliver({
          repository,
          changes: [{ group: RESOLVE_GROUP, from: base, to: resolved }],
          mode: state.run.config.delivery.mode,
          force: false,
          message,
          branch: deliveryBranch(state.run),
          runRef: runRef(state.run),
          include,
        });
      }
    } catch (error) {
      result = { kind: 'failed', message: (error as Error).message };
    }
    await this.outside.accept(state, result);
    await this.dependencies.context.apply(state, { kind: 'delivery_finished', result });
  }

  async deliver(state: RunState, slugs: string[], force: boolean, message: string): Promise<void> {
    let result: DeliveryResult;
    try {
      result = await deliver({
        repository: state.run.repository,
        changes: groupChanges(state, slugs),
        mode: state.run.config.delivery.mode,
        force,
        message,
        branch: deliveryBranch(state.run),
        runRef: runRef(state.run),
        include: state.run.config.workspace.include,
      });
    } catch (error) {
      result = { kind: 'failed', message: (error as Error).message };
    }
    await this.outside.accept(state, result);
    await this.dependencies.context.apply(state, { kind: 'delivery_finished', result });
  }

  async cleanup(state: RunState): Promise<void> {
    // The refs the patch is built from go away with the cleanup.
    await this.dependencies.diff.savePatch(state);
    try {
      await cleanRun({
        repository: state.run.repository,
        root: runWorktreeRoot(workspaceOf(state), state.run.id),
        runBranch: deliveryBranch(state.run),
        groupBranches: [],
        refPrefix: `refs/aip/${state.run.id}/`,
        all: false,
        active: false,
      });
    } catch {
      return;
    }
  }
}
