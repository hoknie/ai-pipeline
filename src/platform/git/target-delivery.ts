import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorEnvironment } from './authorship.ts';
import type { DeliveryOutcome, DeliveryRequest } from './delivery.ts';
import { git, runGit, runGitBuffer } from './runner.ts';

export interface TargetDeliveryRequest extends DeliveryRequest {
  target: { name: string; strategy: 'existing' | 'create' };
  base: string;
  /** The actual HEAD at run creation, distinct from a possible working-tree snapshot. */
  sourceCommit: string;
  /** The local branch checked out when the run was created. */
  sourceBranch: string | null;
}

/** Apply the run to an isolated index, then atomically advance a free local branch. */
export async function deliverToTarget(request: TargetDeliveryRequest): Promise<DeliveryOutcome> {
  const { repository, target } = request;
  const ref = `refs/heads/${target.name}`;
  if (
    (
      await runGit(repository, ['check-ref-format', '--branch', target.name], {
        allowFailure: true,
      })
    ).code !== 0
  )
    return refused('invalid target branch name');
  if (!/^refs\/aip\/[^/]+\/run$/.test(request.runRef))
    return refused('target delivery requires a run ref');
  const { marker, pathspec, paths } = await deliveryDetails(request);
  const existing = await runGit(repository, ['show-ref', '--verify', '--hash', ref], {
    allowFailure: true,
  });
  const recorded = await runGit(repository, ['show-ref', '--verify', '--hash', marker], {
    allowFailure: true,
  });
  if (recorded.code === 0) {
    const commit = recorded.stdout.trim();
    if (
      existing.code !== 0 ||
      (
        await runGit(repository, ['merge-base', '--is-ancestor', commit, existing.stdout.trim()], {
          allowFailure: true,
        })
      ).code !== 0
    )
      return refused('target branch no longer contains the recorded delivery');
    return { kind: 'applied', files: paths, conflicts: [], commit, userEdits: [] };
  }
  if (target.strategy === 'existing' && existing.code !== 0)
    return refused('target branch does not exist');
  if (target.strategy === 'create' && existing.code === 0)
    return refused('target branch already exists');
  const worktrees = await git(repository, 'worktree', 'list', '--porcelain');
  if (worktrees.split('\n').includes(`branch ${ref}`))
    return refused('target branch is checked out in a worktree');
  if (target.strategy === 'create' && !request.sourceBranch)
    return refused('the run has no source branch');
  const source =
    target.strategy === 'create'
      ? await runGit(
          repository,
          ['show-ref', '--verify', '--hash', `refs/heads/${request.sourceBranch}`],
          { allowFailure: true },
        )
      : existing;
  if (source.code !== 0) return refused('source branch no longer exists');
  const tip = source.stdout.trim();
  if (
    (
      await runGit(repository, ['merge-base', '--is-ancestor', request.sourceCommit, tip], {
        allowFailure: true,
      })
    ).code !== 0
  )
    return refused('target branch does not descend from the run base');
  return applyTarget(request, { ref, marker, pathspec, paths, tip });
}

async function deliveryDetails(
  request: TargetDeliveryRequest,
): Promise<{ marker: string; pathspec: string[]; paths: string[] }> {
  const { repository } = request;
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        target: request.target,
        changes: request.changes,
        base: request.base,
        sourceCommit: request.sourceCommit,
        sourceBranch: request.sourceBranch,
        include: request.include ?? [],
      }),
    )
    .digest('hex');
  const marker = `${request.runRef.slice(0, -3)}deliveries/${key}`;
  const pathspec = [
    ':(top)**',
    ...(request.include ?? []).map((path) => `:(top,exclude)${path.replace(/\/+$/, '')}/**`),
    ...(request.include ?? []).map((path) => `:(top,exclude)${path.replace(/\/+$/, '')}`),
  ];
  const files = new Set<string>();
  for (const change of request.changes) {
    const names = await runGit(repository, [
      'diff',
      '--name-only',
      '-z',
      change.from,
      change.to,
      '--',
      ...pathspec,
    ]);
    for (const name of names.stdout.split('\0').filter(Boolean)) files.add(name);
  }
  const paths = [...files].sort();
  return { marker, pathspec, paths };
}

const refused = (reason: string, files: string[] = [], conflict = false): DeliveryOutcome => ({
  kind: 'refused',
  reason,
  files,
  ...(conflict ? { conflict: true } : {}),
});

async function applyTarget(
  request: TargetDeliveryRequest,
  details: { ref: string; marker: string; pathspec: string[]; paths: string[]; tip: string },
): Promise<DeliveryOutcome> {
  const { repository, target } = request;
  const { ref, marker, pathspec, paths, tip } = details;
  const directory = mkdtempSync(join(tmpdir(), 'aip-target-'));
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    await runGit(repository, ['read-tree', tip], { env });
    for (const [index, change] of request.changes.entries()) {
      if (change.from === change.to) continue;
      const args = ['diff', '--binary', '-M', change.from, change.to, '--', ...pathspec];
      const patch = await runGitBuffer(repository, args);
      if (patch.length === 0) continue;
      const file = join(directory, `${index}.patch`);
      writeFileSync(file, patch);
      const applied = await runGit(repository, ['apply', '--cached', '--3way', file], {
        env,
        allowFailure: true,
      });
      if (applied.code !== 0) {
        const unmerged = await runGit(
          repository,
          ['diff', '--name-only', '--diff-filter=U', '-z'],
          { env },
        );
        const conflicts = unmerged.stdout.split('\0').filter(Boolean).sort();
        return refused(
          conflicts.length
            ? 'the changes conflict with the target branch'
            : `patch does not apply: ${applied.stderr.trim()}`,
          conflicts,
          conflicts.length > 0,
        );
      }
    }
    const tree = await gitWithEnv(repository, ['write-tree'], env);
    const commit = await gitWithEnv(
      repository,
      ['commit-tree', tree, '-p', tip, '-m', request.message],
      { ...env, ...authorEnvironment(request.identity) },
    );
    const expected = target.strategy === 'existing' ? tip : '0'.repeat(tip.length);
    const updated = await runGit(repository, ['update-ref', '--stdin'], {
      allowFailure: true,
      input: `start\nupdate ${ref} ${commit} ${expected}\ncreate ${marker} ${commit}\nprepare\ncommit\n`,
    });
    if (updated.code !== 0) return refused('target branch changed during delivery; retry');
    return { kind: 'applied', files: paths, conflicts: [], commit, userEdits: [] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function gitWithEnv(
  repository: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return (await runGit(repository, args, { env })).stdout.trim();
}
