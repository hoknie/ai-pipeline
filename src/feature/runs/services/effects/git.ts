import {
  commitAll,
  commitMessage,
  commitResolve,
  deliver,
  deliverToTarget,
  filesWithMarkers,
  git,
  mergeBranch,
  prepareResolve,
  updateFromBranch,
  type GroupChange,
} from '../../../../platform/git/index.ts';
import type { DeliveryResult, MergeOutcome } from '../../machine/index.ts';
import { targetDelivery } from '../../machine/delivery-flow.ts';
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

import { removeRunFiles } from '../cleanup/index.ts';
import type { ActionRunner } from './actions.ts';
import { purgeGroupConversations } from './conversations.ts';
import type { EffectDependencies } from './context.ts';
import type { OutsideChanges } from './outside.ts';
import { ensureGroupWorktree, resolveWorktree, worktreePath } from './worktrees.ts';

/** The changes a delivery carries: the split result first, then the merged groups in merge order. */
export function groupChanges(state: RunState, slugs: string[]): GroupChange[] {
  const split = state.split;
  const changes: GroupChange[] = [];
  if (split?.mergeCommit != null && split.delivery.state !== 'applied') {
    changes.push({
      group: SPLIT_GROUP,
      from: `${split.mergeCommit}^1`,
      to: split.mergeCommit,
    });
  }
  changes.push(
    ...state.groups
      .filter((group) => slugs.includes(group.slug) && group.mergeCommit !== null)
      .sort((left, right) => (left.mergeSeq ?? 0) - (right.mergeSeq ?? 0))
      .map((group) => ({
        group: group.slug,
        from: `${group.mergeCommit}^1`,
        to: group.mergeCommit as string,
      })),
  );
  return changes;
}

function resolveBaseRef(state: RunState): string {
  return `refs/aip/${state.run.id}/resolve-base`;
}

/**
 * An attempt that failed to move the ref of the run leaves its commit in `HEAD` while the ref stays
 * behind. Rewinding keeps the parent of the new commit at the ref, so a retry does not drop what the
 * previous attempt committed (the groups and the delivery diff from the ref).
 */
async function rewindToRef(tree: string, ref: string): Promise<void> {
  const ahead = Number(await git(tree, 'rev-list', '--count', `${ref}..HEAD`));
  if (ahead > 0) await git(tree, 'reset', '--soft', ref);
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

  /**
   * Commits what the split step left in the worktree of the run into the ref of the run: the groups
   * start from it. No changes mean no commit and no event.
   */
  async commitSplit(state: RunState, stepId: string, summary: string): Promise<void> {
    const split = findGroup(state, SPLIT_GROUP);
    if (!split) return;
    try {
      const tree = await ensureGroupWorktree(state, split);
      const ref = runRef(state.run);
      // A retry after a failed `update-ref` would find everything committed and make no new commit.
      await rewindToRef(tree, ref);
      const commit = await commitAll(
        tree,
        commitMessage(SPLIT_GROUP, stepId, summary),
        ref,
        state.run.config.workspace.include,
      );
      if (commit !== null) {
        await this.dependencies.context.apply(state, { kind: 'split_committed', commit });
      }
    } catch (error) {
      await this.dependencies.context.apply(state, {
        kind: 'commit_failed',
        group: SPLIT_GROUP,
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
    purgeGroupConversations(state, slug);
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
        const stamp = this.dependencies.commits.stamp(state.run, message);
        result = await deliver({
          repository,
          changes: [{ group: RESOLVE_GROUP, from: base, to: resolved }],
          mode: state.run.config.delivery.mode,
          force: false,
          message: stamp?.message ?? message,
          branch: deliveryBranch(state.run),
          runRef: runRef(state.run),
          include,
          base: state.run.baseCommit,
          ...(stamp ? { identity: stamp.identity } : {}),
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
    const target = targetDelivery(state) ? state.run.deliveryBranch : null;
    try {
      const stamp = this.dependencies.commits.stamp(state.run, message);
      const run = state.run;
      const request = {
        repository: state.run.repository,
        changes: groupChanges(state, slugs),
        mode: state.run.config.delivery.mode,
        force,
        message: stamp?.message ?? message,
        branch: deliveryBranch(state.run),
        runRef: runRef(state.run),
        include: state.run.config.workspace.include,
        base: state.run.baseCommit,
        ...(stamp ? { identity: stamp.identity } : {}),
      };
      if (target) {
        if (!run.sourceCommit)
          throw new Error('the run has no recorded source commit for target delivery');
        result = await deliverToTarget({
          ...request,
          base: run.baseCommit,
          target,
          sourceCommit: run.sourceCommit,
          sourceBranch: run.sourceBranch ?? null,
        });
      } else result = await deliver(request);
    } catch (error) {
      result = { kind: 'failed', message: (error as Error).message };
    }
    if (!target) await this.outside.accept(state, result);
    await this.dependencies.context.apply(state, { kind: 'delivery_finished', result });
  }

  /** Sends the branch of the delivery to the remote repository and tells the machine how it went. */
  async push(state: RunState): Promise<void> {
    const outcome = await this.dependencies.push.push(state.run);
    await this.dependencies.context.apply(
      state,
      outcome.ok
        ? { kind: 'delivery_pushed', remoteBranch: outcome.remoteBranch }
        : { kind: 'delivery_push_failed', reason: outcome.reason },
    );
  }

  async cleanup(state: RunState): Promise<void> {
    // The refs the patch is built from go away with the cleanup.
    await this.dependencies.diff.savePatch(state);
    try {
      await removeRunFiles(state, false);
    } catch {
      return;
    }
  }
}
