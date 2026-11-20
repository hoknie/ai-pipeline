import { rejected } from '../../../../platform/errors/index.ts';
import {
  deliver,
  fetchBranch,
  findRemote,
  git,
  refExists,
  repositoryRoot,
} from '../../../../platform/git/index.ts';
import { remoteAddress } from '../../../../feature/delivery/types/index.ts';
import type { ApplyResult, RunView } from '../../../ipc/contract/index.ts';
import { call, type Context } from '../../context.ts';
import { usage } from '../../io.ts';

export interface ServerApplyOptions {
  mode: 'worktree' | 'commit';
  force: boolean;
  groups: string[];
}

/** What `aip run apply` did on this machine: the answer to print, and whether the delivery failed. */
export interface ServerApplyOutcome {
  result: ApplyResult;
  failed: boolean;
}

/** The delivery of the run to the local clone: the branch of the run in the remote repository, from its base to its tip. */
async function localDelivery(
  ctx: Context,
  view: RunView,
  options: ServerApplyOptions,
): Promise<{ root: string; outcome: Awaited<ReturnType<typeof deliver>> }> {
  const remoteBranch = view.remoteBranch;
  const stage = view.deliveryStage;
  const pushFailed =
    stage?.status === 'push_failed' ||
    view.groups.some((group) => group.delivery === 'push_failed');
  if (remoteBranch === null || pushFailed) {
    const why = stage?.status === 'push_failed' && stage.reason ? `: ${stage.reason}` : '';
    throw rejected(
      `the branch of run ${view.id} is not in the remote repository yet; it must be sent first (\`aip run show ${view.id}\`)${why}`,
    );
  }
  const root = await repositoryRoot(ctx.io.cwd);
  const remote = await findRemote(root, (url) => remoteAddress(url) === remoteBranch.address);
  if (remote === null) {
    throw rejected(
      `this clone has no git remote for ${remoteBranch.address}, the repository the branch ${remoteBranch.branch} was sent to: add it (git remote add) and run the command again`,
    );
  }
  const tip = await fetchBranch(root, remote, remoteBranch.branch);
  if (!(await refExists(root, view.baseCommit))) {
    throw rejected(
      `the commit ${view.baseCommit} the run started from is not in this clone: fetch the main branch of ${remote} and try again`,
    );
  }
  const message = await git(root, 'log', '-1', '--format=%B', tip);
  const outcome = await deliver({
    repository: root,
    changes: [{ group: view.id, from: view.baseCommit, to: tip }],
    mode: options.mode,
    force: options.force,
    message,
    branch: remoteBranch.branch,
    runRef: tip,
  });
  return { root, outcome };
}

/** The merged groups of the run, each with the outcome of the local delivery. */
function merged(view: RunView, delivery: ApplyResult['groups'][number]['delivery']) {
  return view.groups
    .filter((group) => group.status === 'merged')
    .map((group) => ({ slug: group.slug, delivery }));
}

/**
 * `aip run apply` with a server profile: the branch `aip/<run>` the server sent to the remote
 * repository is fetched here and delivered into this clone by the same protected delivery as a local
 * run. The groups are marked delivered on the server only after it succeeded.
 */
export async function applyFromServer(
  ctx: Context,
  runId: string,
  options: ServerApplyOptions,
): Promise<ServerApplyOutcome> {
  if (options.groups.length > 0) {
    throw usage('groups cannot be named with a server profile: the whole run is applied');
  }
  const view = (await call(ctx, 'status', { runId })) as RunView;
  if (view.delivery.merged === 0) throw rejected(`run ${runId} has no merged groups to apply`);
  const { outcome } = await localDelivery(ctx, view, options);
  const finishedAt = Date.now();
  if (outcome.kind === 'refused') {
    const delivery = {
      state: 'apply_failed' as const,
      reason: outcome.reason,
      files: outcome.files,
      conflicts: [],
      userEdits: [],
      manual: false,
      finishedAt,
    };
    return { result: { runId, pending: false, groups: merged(view, delivery) }, failed: true };
  }
  // The server counts the groups delivered by their branch already; the call is the journal's entry too.
  await call(ctx, 'run_mark_delivered', { runId, mode: options.mode });
  const delivery = {
    state: 'applied' as const,
    reason: null,
    files: outcome.files,
    conflicts: outcome.conflicts,
    userEdits: outcome.userEdits,
    manual: false,
    finishedAt,
  };
  return { result: { runId, pending: false, groups: merged(view, delivery) }, failed: false };
}
