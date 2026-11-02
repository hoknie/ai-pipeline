import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RUN_WORKTREE,
  changedPaths,
  hashFiles,
  cleanRun,
  hasRunLeftovers,
  commitAll,
  commitMessage,
  ensureWorktree,
  git,
  gitVersion,
  mergeBranch,
  observeGit,
  prepareRunBranch,
  repositoryRoot,
  runWorktreeRoot,
  snapshotWorkingCopy,
  workspaceRoot,
  excludeWorkspace,
  attemptDirectory,
  updateFromBranch,
  type GitCall,
} from '../../src/git/index.ts';

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(): { repo: string; state: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-git-')));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'lib.ts'), 'export const value = 1;\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'initial');
  return { repo, state: join(base, 'state') };
}

async function runWithGroups(repo: string, state: string, groups: string[]) {
  const runBranch = 'aip/run000000001';
  const prepared = await prepareRunBranch(repo, runBranch);
  const root = runWorktreeRoot(state, 'run000000001');
  const runTree = await ensureWorktree(repo, join(root, RUN_WORKTREE), runBranch, null);
  const trees: Record<string, string> = {};
  for (const group of groups) {
    trees[group] = await ensureWorktree(
      repo,
      join(root, group),
      `${runBranch}-${group}`,
      runBranch,
    );
  }
  return { runBranch, prepared, root, runTree, trees };
}

afterEach(() => observeGit(null));

describe('git basics', () => {
  it('accepts the installed git and finds the repository root', async () => {
    expect(await gitVersion()).toMatch(/^\d+\.\d+/);
    const { repo } = repository();
    expect(await repositoryRoot(repo)).toBe(repo);
    await expect(repositoryRoot(tmpdir())).rejects.toThrow('not inside a git repository');
  });

  it('builds a commit subject from the first summary line', () => {
    expect(commitMessage('login', 'code', '\nДобавил форму\nподробности')).toBe(
      'aip(login/code): Добавил форму',
    );
    expect(commitMessage('g', 's', 'x'.repeat(200)).length).toBe(100);
  });
});

describe('workspace directory', () => {
  it('defaults to .aip inside the repository and hides it from git status', async () => {
    const { repo } = repository();
    const workspace = workspaceRoot(repo, '.aip');
    expect(workspace).toBe(join(repo, '.aip'));
    expect(await excludeWorkspace(repo, workspace)).toBe(true);
    expect(await excludeWorkspace(repo, workspace)).toBe(false);
    const { trees } = await runWithGroups(repo, workspace, ['a']);
    expect(trees.a!.startsWith(join(repo, '.aip', 'worktrees'))).toBe(true);
    writeFileSync(join(trees.a!, 'x.ts'), 'x\n');
    expect(sh(repo, 'status', '--porcelain')).toBe('');
    expect(
      readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').match(/^\/\.aip\/$/gm),
    ).toHaveLength(1);
  });

  it('keeps an absolute workspace outside the repository and does not touch the exclude file', async () => {
    const { repo, state } = repository();
    expect(workspaceRoot(repo, state)).toBe(state);
    expect(await excludeWorkspace(repo, state)).toBe(false);
    expect(attemptDirectory(state, 'run1', 'a', 3)).toBe(join(state, 'logs', 'run1', 'a', '3'));
  });
});

describe('run branch', () => {
  it('starts from HEAD without the uncommitted changes and reports the dirty tree', async () => {
    const { repo, state } = repository();
    writeFileSync(join(repo, 'lib.ts'), 'export const value = 2;\n');
    const { prepared, runTree } = await runWithGroups(repo, state, []);
    expect(prepared.dirty).toBe(true);
    expect(prepared.baseCommit).toBe(sh(repo, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(runTree, 'lib.ts'), 'utf8')).toBe('export const value = 1;\n');
    expect(readFileSync(join(repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });
});

describe('group worktrees', () => {
  it('lets two groups change the same file independently', async () => {
    const { repo, state } = repository();
    const { trees } = await runWithGroups(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'lib.ts'), 'export const value = "a";\n');
    writeFileSync(join(trees.b!, 'lib.ts'), 'export const value = "b";\n');
    expect(readFileSync(join(trees.a!, 'lib.ts'), 'utf8')).toContain('"a"');
    expect(readFileSync(join(trees.b!, 'lib.ts'), 'utf8')).toContain('"b"');
    expect(sh(trees.a!, 'branch', '--show-current')).toBe('aip/run000000001-a');
  });

  it('reuses an existing worktree', async () => {
    const { repo, state } = repository();
    const { trees, runBranch } = await runWithGroups(repo, state, ['a']);
    expect(await ensureWorktree(repo, trees.a!, `${runBranch}-a`, runBranch)).toBe(trees.a);
  });

  it('commits step changes and skips a step without changes', async () => {
    const { repo, state } = repository();
    const { trees } = await runWithGroups(repo, state, ['a']);
    const tree = trees.a!;
    expect(await commitAll(tree, 'aip(a/review): ok')).toBeNull();
    writeFileSync(join(tree, 'new.ts'), 'x\n');
    const sha = await commitAll(tree, 'aip(a/code): new file');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(tree, 'log', '-1', '--format=%s')).toBe('aip(a/code): new file');
  });
});

describe('merging', () => {
  it('merges groups into the run branch one after another', async () => {
    const { repo, state } = repository();
    const { trees, runTree, runBranch } = await runWithGroups(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'a.ts'), 'a\n');
    await commitAll(trees.a!, 'aip(a/code): a');
    writeFileSync(join(trees.b!, 'b.ts'), 'b\n');
    await commitAll(trees.b!, 'aip(b/code): b');
    expect(await mergeBranch(runTree, `${runBranch}-a`, 'aip: merge a')).toMatchObject({
      kind: 'merged',
    });
    expect(await mergeBranch(runTree, `${runBranch}-b`, 'aip: merge b')).toMatchObject({
      kind: 'merged',
    });
    expect(existsSync(join(runTree, 'a.ts')) && existsSync(join(runTree, 'b.ts'))).toBe(true);
  });

  it('aborts a conflicting merge, leaves the run branch as it was and lists the files', async () => {
    const { repo, state } = repository();
    const { trees, runTree, runBranch } = await runWithGroups(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'lib.ts'), 'export const value = "a";\n');
    await commitAll(trees.a!, 'aip(a/code): a');
    writeFileSync(join(trees.b!, 'lib.ts'), 'export const value = "b";\n');
    await commitAll(trees.b!, 'aip(b/code): b');
    await mergeBranch(runTree, `${runBranch}-a`, 'aip: merge a');
    const before = sh(runTree, 'rev-parse', 'HEAD');
    expect(await mergeBranch(runTree, `${runBranch}-b`, 'aip: merge b')).toEqual({
      kind: 'conflict',
      files: ['lib.ts'],
    });
    expect(sh(runTree, 'rev-parse', 'HEAD')).toBe(before);
    expect(sh(runTree, 'status', '--porcelain')).toBe('');
  });

  it('updates a group branch from the run branch, leaving conflicts for the specialist to resolve', async () => {
    const { repo, state } = repository();
    const { trees, runTree, runBranch } = await runWithGroups(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'lib.ts'), 'export const value = "a";\n');
    await commitAll(trees.a!, 'aip(a/code): a');
    writeFileSync(join(trees.b!, 'lib.ts'), 'export const value = "b";\n');
    await commitAll(trees.b!, 'aip(b/code): b');
    await mergeBranch(runTree, `${runBranch}-a`, 'aip: merge a');
    expect(await updateFromBranch(trees.b!, runBranch)).toEqual({
      kind: 'conflict',
      files: ['lib.ts'],
    });
    writeFileSync(join(trees.b!, 'lib.ts'), 'export const value = "ab";\n');
    expect(await commitAll(trees.b!, 'aip(b/qa): resolved')).not.toBeNull();
    expect(await mergeBranch(runTree, `${runBranch}-b`, 'aip: merge b')).toMatchObject({
      kind: 'merged',
    });
  });
});

describe('working copy snapshots', () => {
  it('detects files changed in the main working copy during a step', async () => {
    const { repo } = repository();
    writeFileSync(join(repo, 'draft.md'), 'mine\n');
    const before = await snapshotWorkingCopy(repo);
    const unchanged = await snapshotWorkingCopy(repo);
    expect(await changedPaths(repo, before, unchanged)).toEqual([]);
    writeFileSync(join(repo, 'lib.ts'), 'export const value = 3;\n');
    writeFileSync(join(repo, 'stray.ts'), 'x\n');
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo))).toEqual([
      'lib.ts',
      'stray.ts',
    ]);
  });

  it('ignores committing a dirty file without editing it', async () => {
    const { repo } = repository();
    writeFileSync(join(repo, 'draft.md'), 'mine\n');
    const before = await snapshotWorkingCopy(repo);
    sh(repo, 'add', 'draft.md');
    sh(repo, 'commit', '-m', 'draft');
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo))).toEqual([]);
  });

  it('ignores a change of only the modification time', async () => {
    const { repo } = repository();
    writeFileSync(join(repo, 'draft.md'), 'mine\n');
    const before = await snapshotWorkingCopy(repo);
    utimesSync(join(repo, 'draft.md'), new Date(2001, 1, 1), new Date(2001, 1, 1));
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo))).toEqual([]);
  });

  it('reports a deleted file and an edit of a committed file', async () => {
    const { repo } = repository();
    const before = await snapshotWorkingCopy(repo);
    writeFileSync(join(repo, 'lib.ts'), 'changed\n');
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo))).toEqual(['lib.ts']);
    rmSync(join(repo, 'lib.ts'));
    const after = await snapshotWorkingCopy(repo);
    expect(after.files.get('lib.ts')).toBe('missing');
  });

  it('leaves the excluded directory out of the snapshot', async () => {
    const { repo } = repository();
    mkdirSync(join(repo, '.work/logs'), { recursive: true });
    writeFileSync(join(repo, '.work/logs/a.log'), 'x\n');
    writeFileSync(join(repo, 'kept.md'), 'x\n');
    const snapshot = await snapshotWorkingCopy(repo, { exclude: ['.work'] });
    expect([...snapshot.files.keys()]).toEqual(['kept.md']);
  });

  it('accepts overrides and reports an edit made after them', async () => {
    const { repo } = repository();
    const before = await snapshotWorkingCopy(repo);
    writeFileSync(join(repo, 'lib.ts'), 'delivered\n');
    const overrides = await hashFiles(repo, ['lib.ts']);
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo), overrides)).toEqual(
      [],
    );
    writeFileSync(join(repo, 'lib.ts'), 'edited after\n');
    expect(await changedPaths(repo, before, await snapshotWorkingCopy(repo), overrides)).toEqual([
      'lib.ts',
    ]);
  });
});

describe('cleaning', () => {
  it('refuses an active run and removes nothing', async () => {
    const { repo, state } = repository();
    const { root, runBranch } = await runWithGroups(repo, state, ['a']);
    await expect(
      cleanRun({
        repository: repo,
        root,
        runBranch,
        groupBranches: [`${runBranch}-a`],
        refPrefix: null,
        all: true,
        active: true,
      }),
    ).rejects.toThrow('still active');
    expect(existsSync(join(root, 'a'))).toBe(true);
    expect(sh(repo, 'branch', '--list', `${runBranch}*`)).toContain(`${runBranch}-a`);
  });

  it('removes worktrees and group branches, and the run branch only with all', async () => {
    const { repo, state } = repository();
    const { root, runBranch } = await runWithGroups(repo, state, ['a']);
    const plan = {
      repository: repo,
      root,
      runBranch,
      groupBranches: [`${runBranch}-a`],
      refPrefix: null,
      all: false,
      active: false,
    };
    await cleanRun(plan);
    expect(existsSync(root)).toBe(false);
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('aip/run000000001');
    await cleanRun({ ...plan, all: true });
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('');
  });
});

describe('leftovers', () => {
  it('sees a worktree, then only hidden refs, then nothing after cleaning', async () => {
    const { repo, state } = repository();
    const { root, runBranch } = await runWithGroups(repo, state, ['a']);
    const plan = {
      repository: repo,
      root,
      runBranch,
      groupBranches: [`${runBranch}-a`],
      refPrefix: null,
      all: false,
      active: false,
    };
    expect(await hasRunLeftovers(plan)).toBe(true);
    await cleanRun(plan);
    expect(await hasRunLeftovers(plan)).toBe(false);

    const hidden = {
      ...plan,
      root: join(state, 'none'),
      groupBranches: [],
      refPrefix: 'refs/aip/run000000009/',
    };
    expect(await hasRunLeftovers(hidden)).toBe(false);
    await prepareRunBranch(repo, 'refs/aip/run000000009/run');
    expect(await hasRunLeftovers(hidden)).toBe(true);
    await cleanRun(hidden);
    expect(await hasRunLeftovers(hidden)).toBe(false);
  });

  it('reports no leftovers when git fails', async () => {
    expect(
      await hasRunLeftovers({
        repository: join(tmpdir(), 'aip-no-such-repository'),
        root: join(tmpdir(), 'aip-no-such-root'),
        runBranch: 'aip/x',
        groupBranches: [],
        refPrefix: 'refs/aip/x/',
        all: false,
        active: false,
      }),
    ).toBe(false);
  });
});

describe('invariants', () => {
  it('never pushes, checks out or switches branches in the user working copy', async () => {
    const calls: GitCall[] = [];
    observeGit((call) => calls.push(call));
    const { repo, state } = repository();
    const before = sh(repo, 'branch', '--show-current');
    const { trees, runTree, runBranch, root } = await runWithGroups(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'lib.ts'), 'a\n');
    await commitAll(trees.a!, 'a');
    writeFileSync(join(trees.b!, 'lib.ts'), 'b\n');
    await commitAll(trees.b!, 'b');
    await mergeBranch(runTree, `${runBranch}-a`, 'merge a');
    await mergeBranch(runTree, `${runBranch}-b`, 'merge b');
    await updateFromBranch(trees.b!, runBranch);
    await snapshotWorkingCopy(repo);
    await cleanRun({
      repository: repo,
      root,
      runBranch,
      groupBranches: [`${runBranch}-a`, `${runBranch}-b`],
      refPrefix: null,
      all: true,
      active: false,
    });
    const forbidden = calls.filter(
      (call) =>
        call.args.includes('push') ||
        (call.cwd === repo &&
          ['checkout', 'switch', 'reset', 'merge', 'commit', 'add'].includes(call.args[0] ?? '')),
    );
    expect(forbidden).toEqual([]);
    expect(calls.length).toBeGreaterThan(10);
    expect(sh(repo, 'branch', '--show-current')).toBe(before);
    expect(await git(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('hidden refs', () => {
  async function refRun(repo: string, state: string, groups: string[]) {
    const runRefName = 'refs/aip/run000000002/run';
    const prepared = await prepareRunBranch(repo, runRefName);
    const root = runWorktreeRoot(state, 'run000000002');
    const runTree = await ensureWorktree(repo, join(root, RUN_WORKTREE), runRefName, null);
    const trees: Record<string, string> = {};
    for (const group of groups) {
      trees[group] = await ensureWorktree(
        repo,
        join(root, group),
        `refs/aip/run000000002/groups/${group}`,
        runRefName,
      );
    }
    return { runRefName, prepared, root, runTree, trees };
  }

  it('creates no visible branches and keeps worktrees detached', async () => {
    const { repo, state } = repository();
    const { trees } = await refRun(repo, state, ['a']);
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('');
    expect(sh(trees.a!, 'branch', '--show-current')).toBe('');
    expect(sh(repo, 'for-each-ref', '--format=%(refname)', 'refs/aip/')).toBe(
      'refs/aip/run000000002/groups/a\nrefs/aip/run000000002/run',
    );
  });

  it('moves the group ref on commit and the run ref on merge, recording the merge commit', async () => {
    const { repo, state } = repository();
    const { trees, runTree, runRefName } = await refRun(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'a.ts'), 'a\n');
    const commit = await commitAll(trees.a!, 'aip(a/code): a', 'refs/aip/run000000002/groups/a');
    expect(sh(repo, 'rev-parse', 'refs/aip/run000000002/groups/a')).toBe(commit);
    const merged = await mergeBranch(
      runTree,
      'refs/aip/run000000002/groups/a',
      'aip: merge a',
      runRefName,
    );
    expect(merged.kind).toBe('merged');
    const mergeCommit = merged.kind === 'merged' ? merged.commit : null;
    expect(sh(repo, 'rev-parse', runRefName)).toBe(mergeCommit);
    expect(sh(repo, 'diff', '--name-only', `${mergeCommit}^1`, mergeCommit!)).toBe('a.ts');
    expect(
      await mergeBranch(runTree, 'refs/aip/run000000002/groups/b', 'aip: merge b', runRefName),
    ).toEqual({ kind: 'merged', commit: null });
  });

  it('reports a conflict on refs without moving the run ref', async () => {
    const { repo, state } = repository();
    const { trees, runTree, runRefName } = await refRun(repo, state, ['a', 'b']);
    writeFileSync(join(trees.a!, 'lib.ts'), 'a\n');
    await commitAll(trees.a!, 'a', 'refs/aip/run000000002/groups/a');
    writeFileSync(join(trees.b!, 'lib.ts'), 'b\n');
    await commitAll(trees.b!, 'b', 'refs/aip/run000000002/groups/b');
    await mergeBranch(runTree, 'refs/aip/run000000002/groups/a', 'merge a', runRefName);
    const before = sh(repo, 'rev-parse', runRefName);
    expect(
      await mergeBranch(runTree, 'refs/aip/run000000002/groups/b', 'merge b', runRefName),
    ).toEqual({
      kind: 'conflict',
      files: ['lib.ts'],
    });
    expect(sh(repo, 'rev-parse', runRefName)).toBe(before);
  });

  it('cleans hidden refs and worktrees, and the delivery branch only with all', async () => {
    const { repo, state } = repository();
    const { root, runRefName } = await refRun(repo, state, ['a']);
    sh(repo, 'branch', 'aip/run000000002', runRefName);
    const plan = {
      repository: repo,
      root,
      runBranch: 'aip/run000000002',
      groupBranches: [],
      refPrefix: 'refs/aip/run000000002/',
      all: false,
      active: false,
    };
    await cleanRun(plan);
    expect(sh(repo, 'for-each-ref', 'refs/aip/')).toBe('');
    expect(existsSync(root)).toBe(false);
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('aip/run000000002');
    await cleanRun({ ...plan, all: true });
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('');
  });
});

describe('working tree snapshot', () => {
  function dirtyRepository(): string {
    const { repo } = repository();
    writeFileSync(join(repo, 'gone.ts'), 'x\n');
    writeFileSync(join(repo, '.gitignore'), 'openspec/\nbuild/\nCLAUDE.md\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'more');
    writeFileSync(join(repo, 'lib.ts'), 'export const value = 2;\n');
    rmSync(join(repo, 'gone.ts'));
    writeFileSync(join(repo, 'new.ts'), 'new\n');
    mkdirSync(join(repo, 'openspec', 'changes'), { recursive: true });
    writeFileSync(join(repo, 'openspec', 'changes', 'plan.md'), 'plan\n');
    mkdirSync(join(repo, 'build'));
    writeFileSync(join(repo, 'build', 'out.js'), 'out\n');
    writeFileSync(join(repo, 'CLAUDE.md'), 'rules\n');
    sh(repo, 'add', 'new.ts');
    return repo;
  }

  it('starts the run from the working tree without touching the index, branch or files', async () => {
    const repo = dirtyRepository();
    const status = sh(repo, 'status', '--porcelain', '--ignored');
    const head = sh(repo, 'rev-parse', 'HEAD');
    const prepared = await prepareRunBranch(repo, 'refs/aip/r1/run', {
      workingTree: true,
      include: ['openspec/', 'CLAUDE.md', 'missing/'],
      snapshotRef: 'refs/aip/r1/base',
    });
    expect(prepared.dirty).toBe(false);
    expect(prepared.baseCommit).not.toBe(head);
    expect(sh(repo, 'rev-parse', 'refs/aip/r1/base')).toBe(prepared.baseCommit);
    expect(sh(repo, 'rev-parse', 'refs/aip/r1/run')).toBe(prepared.baseCommit);
    expect(sh(repo, 'rev-parse', `${prepared.baseCommit}^`)).toBe(head);
    const files = sh(repo, 'ls-tree', '-r', '--name-only', prepared.baseCommit).split('\n');
    expect(files).toEqual(
      expect.arrayContaining(['lib.ts', 'new.ts', 'openspec/changes/plan.md', 'CLAUDE.md']),
    );
    expect(files).not.toContain('gone.ts');
    expect(files).not.toContain('build/out.js');
    expect(sh(repo, 'show', `${prepared.baseCommit}:lib.ts`)).toBe('export const value = 2;');
    expect(sh(repo, 'status', '--porcelain', '--ignored')).toBe(status);
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(repo, 'branch', '--list')).toBe('* main');
  });

  it('uses HEAD itself when the tree is clean and adds include paths on top of HEAD', async () => {
    const { repo } = repository();
    const head = sh(repo, 'rev-parse', 'HEAD');
    const clean = await prepareRunBranch(repo, 'refs/aip/r2/run', {
      workingTree: true,
      include: [],
      snapshotRef: 'refs/aip/r2/base',
    });
    expect(clean.baseCommit).toBe(head);
    expect(sh(repo, 'for-each-ref', 'refs/aip/r2/base')).toBe('');
    const dirty = dirtyRepository();
    const onHead = await prepareRunBranch(dirty, 'refs/aip/r3/run', {
      workingTree: false,
      include: ['openspec/'],
      snapshotRef: null,
    });
    expect(onHead.dirty).toBe(true);
    expect(sh(dirty, 'show', `${onHead.baseCommit}:lib.ts`)).toBe('export const value = 1;');
    expect(sh(dirty, 'show', `${onHead.baseCommit}:openspec/changes/plan.md`)).toBe('plan');
  });

  it('commits new files of ignored include paths in a worktree', async () => {
    const repo = dirtyRepository();
    const prepared = await prepareRunBranch(repo, 'refs/aip/r4/run', {
      workingTree: true,
      include: ['openspec/'],
      snapshotRef: null,
    });
    const tree = await ensureWorktree(
      repo,
      join(repo, '..', 'wt'),
      'refs/aip/r4/groups/a',
      prepared.baseCommit,
    );
    expect(readFileSync(join(tree, 'openspec', 'changes', 'plan.md'), 'utf8')).toBe('plan\n');
    writeFileSync(join(tree, 'openspec', 'changes', 'tasks.md'), 'tasks\n');
    writeFileSync(join(tree, 'openspec', 'changes', 'plan.md'), 'plan 2\n');
    const commit = await commitAll(tree, 'step', 'refs/aip/r4/groups/a', ['openspec/']);
    expect(commit).not.toBeNull();
    expect(
      sh(repo, 'show', '--name-only', '--format=', commit ?? '')
        .split('\n')
        .sort(),
    ).toEqual(['openspec/changes/plan.md', 'openspec/changes/tasks.md']);
  });
});
