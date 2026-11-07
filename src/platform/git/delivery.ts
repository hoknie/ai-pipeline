import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, gitFailure, runGit, runGitBuffer } from './runner.ts';
import { commitAll, existingPaths, snapshotCommit } from './workspace.ts';

export interface GroupChange {
  group: string;
  from: string;
  to: string;
}

export type DeliveryMode = 'worktree' | 'commit' | 'branch';

export interface DeliveryRequest {
  repository: string;
  changes: GroupChange[];
  mode: DeliveryMode;
  force: boolean;
  message: string;
  branch: string;
  runRef: string;
  /** Paths git ignores that the run carries; never committed in commit mode. */
  include?: string[];
}

export type DeliveryOutcome =
  | {
      kind: 'applied';
      files: string[];
      conflicts: string[];
      commit: string | null;
      userEdits: string[];
    }
  | { kind: 'refused'; reason: string; files: string[]; conflict?: boolean };

export const CONFLICT_REASON = 'the changes conflict with your working tree';

function underInclude(file: string, include: string[]): boolean {
  return include.some((entry) => {
    const path = entry.replace(/\/+$/, '');
    return file === path || file.startsWith(`${path}/`);
  });
}

function lines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export async function changedFiles(
  repository: string,
  from: string,
  to: string,
): Promise<string[]> {
  const output = await git(repository, 'diff', '--name-status', '-M', '-z', from, to);
  const parts = output.split('\0').filter((part) => part !== '');
  const files: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index] ?? '';
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push(parts[index + 1] ?? '', parts[index + 2] ?? '');
      index += 2;
    } else {
      files.push(parts[index + 1] ?? '');
      index += 1;
    }
  }
  return [...new Set(files.filter((file) => file !== ''))].sort();
}

export async function dirtyPaths(repository: string): Promise<string[]> {
  const output = (
    await runGit(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ).stdout;
  const entries = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry.startsWith('R') || entry.startsWith('C')) {
      paths.push(entries[index + 1] ?? '');
      index += 1;
    }
  }
  return paths.filter((path) => path !== '');
}

async function patchFile(
  repository: string,
  change: GroupChange,
  directory: string,
): Promise<string> {
  const patch = (await runGit(repository, ['diff', '--binary', '-M', change.from, change.to]))
    .stdout;
  const path = join(directory, `${change.group}.patch`);
  writeFileSync(path, patch);
  return path;
}

/**
 * One patch with the changes of every group, stacked in order on the base of the first one in a
 * temporary index. Applying the groups one by one to the user's tree loses every group after a
 * conflict: `git apply --3way` refuses a whole patch while the index holds an unmerged path.
 */
async function combinedPatch(
  repository: string,
  changes: GroupChange[],
  directory: string,
): Promise<string> {
  const [first] = changes;
  if (!first) throw gitFailure('no changes to combine');
  if (changes.length === 1) return patchFile(repository, first, directory);
  const environment = { GIT_INDEX_FILE: join(directory, 'combined.index') };
  await runGitWith(repository, ['read-tree', first.from], environment);
  for (const change of changes) {
    const patch = await patchFile(repository, change, directory);
    const result = await runGitWith(
      repository,
      ['apply', '--cached', '--3way', patch],
      environment,
      true,
    );
    if (result.code !== 0) {
      throw gitFailure(
        `the changes of group ${change.group} do not apply on top of the groups before it: ${result.stderr.trim()}`,
      );
    }
  }
  const tree = (await runGitWith(repository, ['write-tree'], environment)).stdout.trim();
  const patch = (await runGit(repository, ['diff', '--binary', '-M', first.from, tree])).stdout;
  const path = join(directory, 'combined.patch');
  writeFileSync(path, patch);
  return path;
}

async function snapshotIndex(
  repository: string,
  path: string,
  include: string[],
): Promise<NodeJS.ProcessEnv> {
  const environment = { GIT_INDEX_FILE: path };
  await runGitWith(repository, ['read-tree', 'HEAD'], environment);
  await runGitWith(repository, ['add', '-A'], environment);
  const extra = existingPaths(repository, include);
  if (extra.length > 0)
    await runGitWith(repository, ['add', '-A', '-f', '--', ...extra], environment);
  return environment;
}

async function runGitWith(
  repository: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  allowFailure = false,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return runGit(repository, args, { allowFailure, env });
}

async function unmerged(repository: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const output = (await runGitWith(repository, ['ls-files', '-u'], env)).stdout.trim();
  return [...new Set(lines(output).map((line) => line.split('\t')[1] ?? ''))]
    .filter(Boolean)
    .sort();
}

export async function probe(
  repository: string,
  patches: string[],
  directory: string,
  include: string[] = [],
): Promise<string[]> {
  const environment = await snapshotIndex(repository, join(directory, 'probe.index'), include);
  const conflicts = new Set<string>();
  for (const patch of patches) {
    const result = await runGitWith(
      repository,
      ['apply', '--3way', '--cached', patch],
      environment,
      true,
    );
    if (result.code !== 0) {
      const files = await unmerged(repository, environment);
      if (files.length === 0) throw gitFailure(`patch does not apply: ${result.stderr.trim()}`);
      for (const file of files) conflicts.add(file);
      break;
    }
  }
  return [...conflicts].sort();
}

async function applyToWorktree(
  repository: string,
  patches: string[],
  directory: string,
  include: string[],
): Promise<string[]> {
  const conflicts = new Set<string>();
  for (const [index, patch] of patches.entries()) {
    const environment = await snapshotIndex(
      repository,
      join(directory, `apply-${index}.index`),
      include,
    );
    const result = await runGitWith(repository, ['apply', '--3way', patch], environment, true);
    if (result.code !== 0) {
      const files = await unmerged(repository, environment);
      if (files.length === 0) throw gitFailure(`patch does not apply: ${result.stderr.trim()}`);
      for (const file of files) conflicts.add(file);
    }
  }
  return [...conflicts].sort();
}

export async function deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
  const { repository } = request;
  const include = request.include ?? [];
  const changes = request.changes.filter((change) => change.from !== change.to);
  const files = [
    ...new Set(
      (
        await Promise.all(changes.map((change) => changedFiles(repository, change.from, change.to)))
      ).flat(),
    ),
  ].sort();
  if (request.mode === 'branch') {
    await git(repository, 'branch', '-f', request.branch, request.runRef);
    return { kind: 'applied', files, conflicts: [], commit: null, userEdits: [] };
  }
  if (request.mode === 'commit') {
    const staged = await runGit(repository, ['diff', '--cached', '--quiet'], {
      allowFailure: true,
    });
    if (staged.code !== 0) {
      return {
        kind: 'refused',
        reason: 'the index has staged changes; commit or unstage them first',
        files: [],
      };
    }
  }
  if (files.length === 0) {
    return { kind: 'applied', files, conflicts: [], commit: null, userEdits: [] };
  }
  const directory = mkdtempSync(join(tmpdir(), 'aip-deliver-'));
  try {
    const patches = [await combinedPatch(repository, changes, directory)];
    const committed =
      request.mode === 'commit' ? files.filter((file) => !underInclude(file, include)) : [];
    const dirty = new Set(await dirtyPaths(repository));
    const userEdits = committed.filter((file) => dirty.has(file));
    if (!request.force) {
      const conflicts = await probe(repository, patches, directory, include);
      if (conflicts.length > 0) {
        return { kind: 'refused', reason: CONFLICT_REASON, files: conflicts, conflict: true };
      }
    }
    const conflicts = await applyToWorktree(repository, patches, directory, include);
    let commit: string | null = null;
    if (request.mode === 'commit' && conflicts.length === 0 && committed.length > 0) {
      await git(repository, 'add', '-A', '--', ...committed);
      await git(repository, 'commit', '--no-verify', '-m', request.message, '--', ...committed);
      commit = await git(repository, 'rev-parse', 'HEAD');
    }
    return { kind: 'applied', files, conflicts, commit, userEdits };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export interface ResolveRequest {
  repository: string;
  /** Worktree of the resolver; recreated on every round. */
  worktree: string;
  changes: GroupChange[];
  include: string[];
  /** Ref that keeps the snapshot the resolver starts from. */
  baseRef: string;
}

export interface PreparedResolve {
  base: string;
  conflicts: string[];
}

/**
 * Snapshots the current working tree of the user, checks it out in the resolver worktree and
 * applies the changes there with a three-way merge, leaving conflict markers in place.
 */
export async function prepareResolve(request: ResolveRequest): Promise<PreparedResolve> {
  const { repository, worktree } = request;
  const base = await snapshotCommit(repository, true, request.include);
  await git(repository, 'update-ref', request.baseRef, base);
  if (existsSync(worktree)) {
    await runGit(repository, ['worktree', 'remove', '--force', worktree], { allowFailure: true });
    rmSync(worktree, { recursive: true, force: true });
    await git(repository, 'worktree', 'prune');
  }
  await git(repository, 'worktree', 'add', '--detach', worktree, base);
  const directory = mkdtempSync(join(tmpdir(), 'aip-resolve-'));
  try {
    const changes = request.changes.filter((change) => change.from !== change.to);
    if (changes.length > 0) {
      const patch = await combinedPatch(repository, changes, directory);
      const result = await runGit(worktree, ['apply', '--3way', patch], { allowFailure: true });
      if (result.code !== 0 && (await unmergedIn(worktree)).length === 0) {
        throw gitFailure(`patch does not apply: ${result.stderr.trim()}`);
      }
    }
    return { base, conflicts: await unmergedIn(worktree) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function unmergedIn(worktree: string): Promise<string[]> {
  return lines(await git(worktree, 'diff', '--name-only', '--diff-filter=U')).sort();
}

const MARKER = /^(<{7}|>{7})( |$)|^={7}$/m;

/** Files among `files` of the worktree that still contain conflict markers. */
export function filesWithMarkers(worktree: string, files: string[]): string[] {
  return files.filter((file) => {
    const path = join(worktree, file);
    return existsSync(path) && MARKER.test(readFileSync(path, 'utf8'));
  });
}

/** Commits what the resolver left in its worktree; returns the commit, or `base` without changes. */
export async function commitResolve(
  worktree: string,
  base: string,
  include: string[],
): Promise<string> {
  return (await commitAll(worktree, 'aip: resolve delivery conflicts', null, include)) ?? base;
}

export interface FileStat {
  path: string;
  /** Added lines; null for a binary file. */
  added: number | null;
  removed: number | null;
  /** Old path of a renamed file. */
  previousPath?: string;
}

export interface DiffStat {
  files: FileStat[];
  added: number;
  removed: number;
}

/** Changed files between two commits with added and removed lines (`git diff --numstat`). */
export async function diffStat(repository: string, from: string, to: string): Promise<DiffStat> {
  const output = (await runGit(repository, ['diff', '--numstat', '-z', '-M', from, to])).stdout;
  const parts = output.split('\0');
  const files: FileStat[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const head = parts[index] ?? '';
    if (head === '') continue;
    const [added = '-', removed = '-', path = ''] = head.split('\t');
    // A rename prints an empty path followed by the old and the new path.
    let name = path;
    let previousPath: string | undefined;
    if (path === '') {
      previousPath = parts[index + 1] ?? '';
      name = parts[index + 2] ?? '';
      index += 2;
    }
    files.push({
      path: name,
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
      ...(previousPath ? { previousPath } : {}),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
  };
}

export interface FileDiffResult {
  /** Lines of the diff after the `diff --git`, `index`, `---` and `+++` headers. */
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

/** Diff of the given paths (a renamed file needs both) with `context` lines around each change. */
export async function fileDiff(
  repository: string,
  from: string,
  to: string,
  paths: string[],
  options: { context: number; maxLines: number },
): Promise<FileDiffResult> {
  const output = (
    await runGit(repository, [
      'diff',
      `-U${options.context}`,
      '-M',
      '--no-color',
      from,
      to,
      '--',
      ...paths,
    ])
  ).stdout;
  const all = lines(output.replace(/\n$/, ''));
  const start = all.findIndex((line) => line.startsWith('@@'));
  const body = start < 0 ? [] : all.slice(start);
  return {
    lines: body.slice(0, options.maxLines),
    totalLines: body.length,
    truncated: body.length > options.maxLines,
  };
}

/** Patch of `from..to` for `git apply`, binary files included, as raw bytes. */
export async function rangePatch(repository: string, from: string, to: string): Promise<Buffer> {
  return runGitBuffer(repository, ['diff', '--binary', '-M', from, to]);
}
