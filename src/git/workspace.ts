import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { GitError, git, runGit } from './runner.ts';

export const MINIMUM_GIT_VERSION = [2, 20] as const;

export async function gitVersion(): Promise<string> {
  const output = await git(process.cwd(), '--version');
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) throw new Error(`cannot parse git version from "${output}"`);
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [needMajor, needMinor] = MINIMUM_GIT_VERSION;
  if (major < needMajor || (major === needMajor && minor < needMinor)) {
    throw new Error(`git ${match[0]} is too old; aip needs ${needMajor}.${needMinor} or newer`);
  }
  return match[0];
}

export async function repositoryRoot(directory: string): Promise<string> {
  try {
    return await git(directory, 'rev-parse', '--show-toplevel');
  } catch (error) {
    if (error instanceof GitError) throw new Error(`${directory} is not inside a git repository`);
    throw error;
  }
}

export interface PreparedRun {
  baseCommit: string;
  /** The repository has uncommitted changes that are not part of the run. */
  dirty: boolean;
}

export interface RunBase {
  /** Start from a snapshot of the working tree instead of `HEAD`. */
  workingTree: boolean;
  /** Paths added to the base even when git ignores them. */
  include: string[];
  /** Ref that keeps the snapshot commit, when one is made. */
  snapshotRef: string | null;
}

const HEAD_BASE: RunBase = { workingTree: false, include: [], snapshotRef: null };

export async function prepareRunBranch(
  repository: string,
  branch: string,
  base: RunBase = HEAD_BASE,
): Promise<PreparedRun> {
  const head = await git(repository, 'rev-parse', '--verify', 'HEAD^{commit}');
  const dirty = (await git(repository, 'status', '--porcelain')) !== '';
  const baseCommit =
    base.workingTree || base.include.length > 0
      ? await snapshotCommit(repository, base.workingTree, base.include)
      : head;
  if (baseCommit !== head && base.snapshotRef !== null) {
    await git(repository, 'update-ref', base.snapshotRef, baseCommit);
  }
  if (isRef(branch)) await git(repository, 'update-ref', branch, baseCommit);
  else await git(repository, 'branch', branch, baseCommit);
  return { baseCommit, dirty: dirty && !base.workingTree };
}

/** Paths of `include` that exist in the directory, relative to it. */
export function existingPaths(directory: string, include: string[]): string[] {
  return include
    .map((path) => path.replace(/\/+$/, ''))
    .filter((path) => path !== '' && existsSync(join(directory, path)));
}

/**
 * Commits the working tree of `repository` on top of `HEAD` without touching the user's index,
 * branch or files: every change, deletion and untracked file that git does not ignore, plus the
 * `include` paths even when git ignores them. With `workingTree` false only `include` is added.
 * Returns `HEAD` itself when the result is the same tree.
 */
export async function snapshotCommit(
  repository: string,
  workingTree: boolean,
  include: string[],
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'aip-snapshot-'));
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    await runGit(repository, ['read-tree', 'HEAD'], { env });
    if (workingTree) await runGit(repository, ['add', '-A'], { env });
    const extra = existingPaths(repository, include);
    if (extra.length > 0) await runGit(repository, ['add', '-A', '-f', '--', ...extra], { env });
    const tree = (await runGit(repository, ['write-tree'], { env })).stdout.trim();
    const head = await git(repository, 'rev-parse', 'HEAD');
    if (tree === (await git(repository, 'rev-parse', 'HEAD^{tree}'))) return head;
    return await git(
      repository,
      'commit-tree',
      tree,
      '-p',
      head,
      '-m',
      'aip: snapshot of the working tree',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function isRef(name: string): boolean {
  return name.startsWith('refs/');
}

export async function refExists(repository: string, ref: string): Promise<boolean> {
  const result = await runGit(repository, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowFailure: true,
  });
  return result.code === 0;
}

export function workspaceRoot(repository: string, workspaceDir: string): string {
  return isAbsolute(workspaceDir) ? workspaceDir : join(repository, workspaceDir);
}

export function runWorktreeRoot(workspace: string, runId: string): string {
  return join(workspace, 'worktrees', runId);
}

export function attemptDirectory(
  workspace: string,
  runId: string,
  group: string,
  seq: number,
): string {
  return join(workspace, 'logs', runId, group, String(seq));
}

export async function excludeWorkspace(repository: string, workspace: string): Promise<boolean> {
  const path = relative(repository, workspace);
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return false;
  const pattern = `/${path.split(sep).join('/')}/`;
  const excludeFile = await git(
    repository,
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'info/exclude',
  );
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : '';
  if (current.split('\n').some((line) => line.trim() === pattern)) return false;
  mkdirSync(dirname(excludeFile), { recursive: true });
  appendFileSync(
    excludeFile,
    `${current === '' || current.endsWith('\n') ? '' : '\n'}${pattern}\n`,
  );
  return true;
}

export const RUN_WORKTREE = '_run';

export async function ensureWorktree(
  repository: string,
  path: string,
  branch: string,
  from: string | null,
): Promise<string> {
  if (existsSync(join(path, '.git'))) return path;
  if (isRef(branch)) {
    if (from !== null && !(await refExists(repository, branch))) {
      await git(repository, 'update-ref', branch, `${from}^{commit}`);
    }
    await git(repository, 'worktree', 'add', '--detach', path, branch);
    return path;
  }
  const args =
    from === null
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path, from];
  await git(repository, ...args);
  return path;
}

export function commitMessage(group: string, step: string, summary: string): string {
  const firstLine =
    summary
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? step;
  const subject = `aip(${group}/${step}): ${firstLine}`;
  return subject.length > 100 ? `${subject.slice(0, 99)}…` : subject;
}

export async function commitAll(
  worktree: string,
  message: string,
  ref: string | null = null,
  include: string[] = [],
): Promise<string | null> {
  await git(worktree, 'add', '-A');
  const extra = existingPaths(worktree, include);
  if (extra.length > 0) await git(worktree, 'add', '-A', '-f', '--', ...extra);
  const staged = await runGit(worktree, ['diff', '--cached', '--quiet'], { allowFailure: true });
  const merging = existsSync(await gitPath(worktree, 'MERGE_HEAD'));
  if (staged.code === 0 && !merging) return null;
  await git(worktree, 'commit', '--no-verify', '--no-edit', '-m', message);
  const commit = await git(worktree, 'rev-parse', 'HEAD');
  if (ref !== null && isRef(ref)) await git(worktree, 'update-ref', ref, commit);
  return commit;
}

async function gitPath(worktree: string, name: string): Promise<string> {
  return git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', name);
}

async function conflictedFiles(worktree: string): Promise<string[]> {
  const output = await git(worktree, 'diff', '--name-only', '--diff-filter=U');
  return output === '' ? [] : output.split('\n');
}

export type MergeResult =
  { kind: 'merged'; commit: string | null } | { kind: 'conflict'; files: string[] };

export async function mergeBranch(
  runWorktree: string,
  branch: string,
  message: string,
  target: string | null = null,
): Promise<MergeResult> {
  const before = await git(runWorktree, 'rev-parse', 'HEAD');
  const result = await runGit(
    runWorktree,
    ['merge', '--no-ff', '--no-edit', '-m', message, branch],
    {
      allowFailure: true,
    },
  );
  if (result.code === 0) {
    const after = await git(runWorktree, 'rev-parse', 'HEAD');
    if (target !== null && isRef(target)) await git(runWorktree, 'update-ref', target, after);
    return { kind: 'merged', commit: after === before ? null : after };
  }
  const files = await conflictedFiles(runWorktree);
  await runGit(runWorktree, ['merge', '--abort'], { allowFailure: true });
  if (files.length === 0)
    throw new GitError(['merge', branch], result.code, result.stderr || result.stdout);
  return { kind: 'conflict', files };
}

export async function updateFromBranch(
  worktree: string,
  branch: string,
  target: string | null = null,
): Promise<MergeResult> {
  const result = await runGit(worktree, ['merge', '--no-edit', branch], { allowFailure: true });
  if (result.code === 0) {
    const commit = await git(worktree, 'rev-parse', 'HEAD');
    if (target !== null && isRef(target)) await git(worktree, 'update-ref', target, commit);
    return { kind: 'merged', commit };
  }
  const files = await conflictedFiles(worktree);
  if (files.length === 0)
    throw new GitError(['merge', branch], result.code, result.stderr || result.stdout);
  return { kind: 'conflict', files };
}

export interface Snapshot {
  head: string;
  /** Dirty paths of the working copy and the git blob hash of their content ('missing' if gone). */
  files: Map<string, string>;
}

export interface SnapshotOptions {
  /** Path prefixes (relative to the repository) that are left out of the snapshot. */
  exclude?: string[];
}

const HASH_BATCH = 100;

export function under(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    const clean = prefix.replace(/\/+$/, '');
    return clean !== '' && (path === clean || path.startsWith(`${clean}/`));
  });
}

/** Git blob hashes of the files' current content; 'missing' for what is not a file. */
export async function hashFiles(repository: string, paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const present: string[] = [];
  for (const path of paths) {
    try {
      if (statSync(join(repository, path)).isFile()) present.push(path);
      else result.set(path, 'missing');
    } catch {
      result.set(path, 'missing');
    }
  }
  for (let index = 0; index < present.length; index += HASH_BATCH) {
    const batch = present.slice(index, index + HASH_BATCH);
    const output = (await runGit(repository, ['hash-object', '--', ...batch])).stdout;
    const hashes = output.split('\n');
    batch.forEach((path, position) => result.set(path, hashes[position] ?? 'missing'));
  }
  return result;
}

export async function snapshotWorkingCopy(
  repository: string,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const exclude = options.exclude ?? [];
  const head = await git(repository, 'rev-parse', '--verify', 'HEAD^{commit}');
  const output = (
    await runGit(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ).stdout;
  const paths: string[] = [];
  const entries = output.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.startsWith('R') || status.startsWith('C')) {
      index += 1;
      const source = entries[index];
      if (source) paths.push(source);
    }
  }
  const kept = [...new Set(paths)].filter((path) => !under(path, exclude));
  return { head, files: await hashFiles(repository, kept) };
}

/** Blob hashes of `paths` as the snapshot saw them: dirty files from it, the rest from its HEAD. */
export async function contentsAt(
  repository: string,
  snapshot: Snapshot,
  paths: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const committed: string[] = [];
  for (const path of paths) {
    const dirty = snapshot.files.get(path);
    if (dirty === undefined) committed.push(path);
    else result.set(path, dirty);
  }
  for (let index = 0; index < committed.length; index += HASH_BATCH) {
    const batch = committed.slice(index, index + HASH_BATCH);
    const output = (
      await runGit(repository, ['ls-tree', '-r', '-z', snapshot.head, '--', ...batch])
    ).stdout;
    const found = new Map<string, string>();
    for (const line of output.split('\0')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const hash = line.slice(0, tab).split(' ')[2];
      if (hash) found.set(line.slice(tab + 1), hash);
    }
    for (const path of batch) result.set(path, found.get(path) ?? 'missing');
  }
  return result;
}

/**
 * Paths whose content differs between two snapshots. `overrides` replace the content of the
 * `before` side for the paths they name (used to accept changes aip itself made).
 */
export async function changedPaths(
  repository: string,
  before: Snapshot,
  after: Snapshot,
  overrides: Map<string, string> = new Map(),
): Promise<string[]> {
  const candidates = new Set([...before.files.keys(), ...after.files.keys(), ...overrides.keys()]);
  if (before.head !== after.head) {
    const names = (await runGit(repository, ['diff', '--name-only', '-z', before.head, after.head]))
      .stdout;
    for (const name of names.split('\0')) if (name !== '') candidates.add(name);
  }
  const paths = [...candidates];
  const [was, now] = await Promise.all([
    contentsAt(repository, before, paths),
    contentsAt(repository, after, paths),
  ]);
  return paths.filter((path) => (overrides.get(path) ?? was.get(path)) !== now.get(path)).sort();
}

export interface CleanPlan {
  repository: string;
  root: string;
  runBranch: string;
  groupBranches: string[];
  refPrefix: string | null;
  all: boolean;
  active: boolean;
}

/** Whether a run still has a worktree, hidden refs or group branches that `cleanRun` removes. */
export async function hasRunLeftovers(plan: CleanPlan): Promise<boolean> {
  try {
    if (existsSync(plan.root)) return true;
    if (plan.refPrefix !== null) {
      const refs = await git(
        plan.repository,
        'for-each-ref',
        '--count=1',
        '--format=%(refname)',
        plan.refPrefix,
      );
      if (refs !== '') return true;
    }
    for (const branch of plan.groupBranches) {
      const exists = await runGit(
        plan.repository,
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
        { allowFailure: true },
      );
      if (exists.code === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function cleanRun(plan: CleanPlan): Promise<string[]> {
  if (plan.active) throw new Error('the run is still active; cancel it or wait for it to finish');
  const removed: string[] = [];
  if (existsSync(plan.root)) {
    const list = await git(plan.repository, 'worktree', 'list', '--porcelain');
    const worktrees = list
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .filter((path) => path.startsWith(plan.root));
    for (const path of worktrees) {
      await git(plan.repository, 'worktree', 'remove', '--force', path);
      removed.push(path);
    }
    rmSync(plan.root, { recursive: true, force: true });
  }
  await git(plan.repository, 'worktree', 'prune');
  if (plan.refPrefix !== null) {
    const refs = await git(plan.repository, 'for-each-ref', '--format=%(refname)', plan.refPrefix);
    for (const ref of refs === '' ? [] : refs.split('\n')) {
      await git(plan.repository, 'update-ref', '-d', ref);
      removed.push(ref);
    }
  }
  const branches = plan.all ? [...plan.groupBranches, plan.runBranch] : plan.groupBranches;
  for (const branch of branches) {
    const exists = await runGit(
      plan.repository,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      {
        allowFailure: true,
      },
    );
    if (exists.code !== 0) continue;
    await git(plan.repository, 'branch', '-D', branch);
    removed.push(branch);
  }
  return removed;
}

function lines(output: string): string[] {
  return output === '' ? [] : output.split('\n');
}

/** Paths under `pathspec` that differ from `base` in the working tree, including untracked files. */
export async function changedPathsSince(
  worktree: string,
  base: string,
  pathspec: string,
): Promise<string[]> {
  const tracked = lines(await git(worktree, 'diff', '--name-only', base, '--', pathspec));
  const untracked = lines(
    await git(worktree, 'ls-files', '--others', '--exclude-standard', '--', pathspec),
  );
  return [...new Set([...tracked, ...untracked])];
}

/** Paths under `pathspec` that exist in `to` and differ from `from`. */
export async function changedPathsBetween(
  repository: string,
  from: string,
  to: string,
  pathspec: string,
): Promise<string[]> {
  return lines(
    await git(repository, 'diff', '--name-only', '--diff-filter=d', from, to, '--', pathspec),
  );
}

/** The content of a file in a commit, or `null` when the commit has no such file. */
export async function readFileAt(
  repository: string,
  commit: string,
  path: string,
): Promise<string | null> {
  try {
    return (await runGit(repository, ['show', `${commit}:${path}`])).stdout;
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}
