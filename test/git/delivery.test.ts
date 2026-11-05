import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFLICT_REASON,
  RUN_WORKTREE,
  commitAll,
  commitResolve,
  diffStat,
  fileDiff,
  rangePatch,
  filesWithMarkers,
  prepareResolve,
  deliver,
  ensureWorktree,
  mergeBranch,
  prepareRunBranch,
  runWorktreeRoot,
  type DeliveryRequest,
  type GroupChange,
} from '../../src/git/index.ts';

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const RUN = 'refs/aip/run000000003/run';

async function setup(
  edit: (tree: string) => void,
  include: string[] = [],
): Promise<{ repo: string; change: GroupChange }> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-deliver-test-')));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'app.ts'), 'one\ntwo\nthree\n');
  writeFileSync(join(repo, 'other.ts'), 'other\n');
  writeFileSync(join(repo, 'old.ts'), 'old\n');
  writeFileSync(join(repo, 'logo.bin'), Buffer.from([0, 1, 2]));
  writeFileSync(join(repo, '.gitignore'), 'plans/\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  mkdirSync(join(repo, 'plans'));
  writeFileSync(join(repo, 'plans', 'plan.md'), 'plan\n');
  await prepareRunBranch(repo, RUN, { workingTree: true, include, snapshotRef: null });
  const root = runWorktreeRoot(join(base, 'work'), 'run000000003');
  const runTree = await ensureWorktree(repo, join(root, RUN_WORKTREE), RUN, null);
  const groupRef = 'refs/aip/run000000003/groups/a';
  const tree = await ensureWorktree(repo, join(root, 'a'), groupRef, RUN);
  edit(tree);
  await commitAll(tree, 'aip(a/code): change', groupRef, include);
  const merged = await mergeBranch(runTree, groupRef, 'aip: merge a', RUN);
  if (merged.kind !== 'merged' || !merged.commit) throw new Error('merge failed');
  return { repo, change: { group: 'a', from: `${merged.commit}^1`, to: merged.commit } };
}

type GroupEdit = [group: string, edit: (tree: string) => void];

/**
 * A run with groups merged one after the other: `a` edits app.ts, `b` app.ts and more, then the
 * `extra` groups.
 */
async function setupGroups(
  extra: GroupEdit[] = [],
): Promise<{ repo: string; changes: GroupChange[] }> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-deliver-test-')));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'app.ts'), 'one\ntwo\nthree\n');
  writeFileSync(join(repo, 'other.ts'), 'other\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  await prepareRunBranch(repo, RUN, { workingTree: true, include: [], snapshotRef: null });
  const root = runWorktreeRoot(join(base, 'work'), 'run000000003');
  const runTree = await ensureWorktree(repo, join(root, RUN_WORKTREE), RUN, null);
  const edits: GroupEdit[] = [
    ['a', editApp],
    [
      'b',
      (tree) => {
        writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\nfour\n');
        writeFileSync(join(tree, 'other.ts'), 'other b\n');
        writeFileSync(join(tree, 'added.ts'), 'added by b\n');
      },
    ],
    ...extra,
  ];
  const changes: GroupChange[] = [];
  for (const [group, edit] of edits) {
    const groupRef = `refs/aip/run000000003/groups/${group}`;
    const tree = await ensureWorktree(repo, join(root, group), groupRef, RUN);
    edit(tree);
    await commitAll(tree, `aip(${group}/code): change`, groupRef, []);
    const merged = await mergeBranch(runTree, groupRef, `aip: merge ${group}`, RUN);
    if (merged.kind !== 'merged' || !merged.commit) throw new Error('merge failed');
    changes.push({ group, from: `${merged.commit}^1`, to: merged.commit });
  }
  return { repo, changes };
}

function request(
  repo: string,
  change: GroupChange,
  overrides: Partial<DeliveryRequest> = {},
): DeliveryRequest {
  return {
    repository: repo,
    changes: [change],
    mode: 'worktree',
    force: false,
    message: 'feat: from aip',
    branch: 'aip/run000000003',
    runRef: RUN,
    ...overrides,
  };
}

const editApp = (tree: string) => writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\n');

describe('delivery into the working tree', () => {
  it('leaves the changes uncommitted, without new commits, branches or staged files', async () => {
    const { repo, change } = await setup(editApp);
    const head = sh(repo, 'rev-parse', 'HEAD');
    expect(await deliver(request(repo, change))).toEqual({
      kind: 'applied',
      files: ['app.ts'],
      conflicts: [],
      commit: null,
      userEdits: [],
    });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\nTWO\nthree\n');
    expect(sh(repo, 'status', '--porcelain')).toBe('M app.ts');
    expect(sh(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('');
  });

  it('applies on top of new commits in the user branch', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'other.ts'), 'other changed\n');
    sh(repo, 'commit', '-q', '-am', 'user work');
    expect((await deliver(request(repo, change))).kind).toBe('applied');
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toContain('TWO');
    expect(readFileSync(join(repo, 'other.ts'), 'utf8')).toBe('other changed\n');
  });

  it('merges with uncommitted edits of the user in another place of the same file', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\ntwo\nthree\nmine\n');
    expect(await deliver(request(repo, change))).toMatchObject({
      kind: 'applied',
      files: ['app.ts'],
      conflicts: [],
    });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\nTWO\nthree\nmine\n');
    expect(sh(repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('refuses when uncommitted edits of the user conflict and changes nothing', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\nmine\nthree\n');
    expect(await deliver(request(repo, change))).toEqual({
      kind: 'refused',
      reason: CONFLICT_REASON,
      files: ['app.ts'],
      conflict: true,
    });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\nmine\nthree\n');
    expect(sh(repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('refuses a conflict with a commit of the user and changes nothing', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\ncommitted\nthree\n');
    sh(repo, 'commit', '-q', '-am', 'conflicting');
    expect(await deliver(request(repo, change))).toEqual({
      kind: 'refused',
      reason: CONFLICT_REASON,
      files: ['app.ts'],
      conflict: true,
    });
    expect(sh(repo, 'status', '--porcelain')).toBe('');
  });

  it('applies with conflict markers when forced', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\ncommitted\nthree\n');
    sh(repo, 'commit', '-q', '-am', 'conflicting');
    const outcome = await deliver(request(repo, change, { force: true }));
    expect(outcome).toMatchObject({ kind: 'applied', conflicts: ['app.ts'] });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toContain('<<<<<<<');
    expect(sh(repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('handles renames, deletions, new and binary files', async () => {
    const { repo, change } = await setup((tree) => {
      execFileSync('git', ['mv', 'old.ts', 'renamed.ts'], { cwd: tree });
      writeFileSync(join(tree, 'logo.bin'), Buffer.from([0, 9, 9]));
      writeFileSync(join(tree, 'new.ts'), 'new\n');
      execFileSync('git', ['rm', '-q', 'other.ts'], { cwd: tree });
    });
    const outcome = await deliver(request(repo, change));
    expect(outcome).toMatchObject({
      kind: 'applied',
      files: ['logo.bin', 'new.ts', 'old.ts', 'other.ts', 'renamed.ts'],
    });
    expect(existsSync(join(repo, 'old.ts'))).toBe(false);
    expect(existsSync(join(repo, 'other.ts'))).toBe(false);
    expect(readFileSync(join(repo, 'renamed.ts'), 'utf8')).toBe('old\n');
    expect([...readFileSync(join(repo, 'logo.bin'))]).toEqual([0, 9, 9]);
  });
});

describe('commit and branch modes', () => {
  it('commits only the files of the run and keeps other uncommitted work', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'notes.md'), 'mine\n');
    const outcome = await deliver(request(repo, change, { mode: 'commit' }));
    expect(outcome).toMatchObject({ kind: 'applied', files: ['app.ts'] });
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('feat: from aip');
    expect(sh(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('app.ts');
    expect(sh(repo, 'status', '--porcelain')).toBe('?? notes.md');
  });

  it('leaves ignored include paths uncommitted and lists files committed with user edits', async () => {
    const editBoth = (tree: string) => {
      writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\n');
      writeFileSync(join(tree, 'plans', 'plan.md'), 'plan 2\n');
      writeFileSync(join(tree, 'plans', 'tasks.md'), 'tasks\n');
    };
    const { repo, change } = await setup(editBoth, ['plans/']);
    writeFileSync(join(repo, 'app.ts'), 'one\ntwo\nthree\nmine\n');
    const outcome = await deliver(request(repo, change, { mode: 'commit', include: ['plans/'] }));
    expect(outcome).toMatchObject({
      kind: 'applied',
      files: ['app.ts', 'plans/plan.md', 'plans/tasks.md'],
      userEdits: ['app.ts'],
    });
    expect(sh(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('app.ts');
    expect(sh(repo, 'show', 'HEAD:app.ts')).toBe('one\nTWO\nthree\nmine');
    expect(readFileSync(join(repo, 'plans', 'plan.md'), 'utf8')).toBe('plan 2\n');
    expect(readFileSync(join(repo, 'plans', 'tasks.md'), 'utf8')).toBe('tasks\n');
    expect(sh(repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses commit mode when the index has staged changes', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'notes.md'), 'mine\n');
    sh(repo, 'add', 'notes.md');
    expect(await deliver(request(repo, change, { mode: 'commit' }))).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('staged'),
    });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('does not commit when forced into conflicts', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\ncommitted\nthree\n');
    sh(repo, 'commit', '-q', '-am', 'conflicting');
    const outcome = await deliver(request(repo, change, { mode: 'commit', force: true }));
    expect(outcome).toMatchObject({ kind: 'applied', conflicts: ['app.ts'], commit: null });
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('conflicting');
  });

  it('creates a visible branch and leaves the working tree as it is', async () => {
    const { repo, change } = await setup(editApp);
    expect((await deliver(request(repo, change, { mode: 'branch' }))).kind).toBe('applied');
    expect(sh(repo, 'branch', '--list', 'aip/*')).toBe('aip/run000000003');
    expect(sh(repo, 'show', 'aip/run000000003:app.ts')).toContain('TWO');
    expect(sh(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('resolver worktree', () => {
  it('prepares the current working tree with conflict markers and commits the resolution', async () => {
    const { repo, change } = await setup(editApp);
    writeFileSync(join(repo, 'app.ts'), 'one\nmine\nthree\n');
    writeFileSync(join(repo, 'notes.md'), 'notes\n');
    const worktree = join(repo, '..', 'resolve');
    const prepared = await prepareResolve({
      repository: repo,
      worktree,
      changes: [change],
      include: ['plans/'],
      baseRef: 'refs/aip/run000000003/resolve-base',
    });
    expect(prepared.conflicts).toEqual(['app.ts']);
    expect(sh(repo, 'rev-parse', 'refs/aip/run000000003/resolve-base')).toBe(prepared.base);
    expect(readFileSync(join(worktree, 'notes.md'), 'utf8')).toBe('notes\n');
    expect(readFileSync(join(worktree, 'plans', 'plan.md'), 'utf8')).toBe('plan\n');
    expect(filesWithMarkers(worktree, ['app.ts', 'notes.md'])).toEqual(['app.ts']);
    writeFileSync(join(worktree, 'app.ts'), 'one\nmine and TWO\nthree\n');
    expect(filesWithMarkers(worktree, ['app.ts'])).toEqual([]);
    const resolved = await commitResolve(worktree, prepared.base, ['plans/']);
    expect(sh(repo, 'diff', '--name-only', prepared.base, resolved)).toBe('app.ts');
    const again = await prepareResolve({
      repository: repo,
      worktree,
      changes: [change],
      include: [],
      baseRef: 'refs/aip/run000000003/resolve-base',
    });
    expect(again.conflicts).toEqual(['app.ts']);
    expect(sh(repo, 'status', '--porcelain')).toBe('M app.ts\n?? notes.md');
  });
});

describe('several groups', () => {
  it('delivers every group in order', async () => {
    const { repo, changes } = await setupGroups();
    const result = await deliver({ ...request(repo, changes[0]!), changes });
    expect(result).toMatchObject({ kind: 'applied', conflicts: [] });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\nTWO\nthree\nfour\n');
    expect(readFileSync(join(repo, 'other.ts'), 'utf8')).toBe('other b\n');
    expect(readFileSync(join(repo, 'added.ts'), 'utf8')).toBe('added by b\n');
  });

  it('keeps the later groups when the first one conflicts with the user, when forced', async () => {
    const { repo, changes } = await setupGroups();
    writeFileSync(join(repo, 'app.ts'), 'one\nmine\nthree\n');
    const result = await deliver({ ...request(repo, changes[0]!), changes, force: true });
    expect(result).toMatchObject({ kind: 'applied', conflicts: ['app.ts'] });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toContain('<<<<<<<');
    expect(readFileSync(join(repo, 'other.ts'), 'utf8')).toBe('other b\n');
    expect(readFileSync(join(repo, 'added.ts'), 'utf8')).toBe('added by b\n');
  });

  it('gives the resolver the changes of every group, not only up to the first conflict', async () => {
    const { repo, changes } = await setupGroups();
    writeFileSync(join(repo, 'app.ts'), 'one\nmine\nthree\n');
    const worktree = join(repo, '..', 'resolve');
    const prepared = await prepareResolve({
      repository: repo,
      worktree,
      changes,
      include: [],
      baseRef: 'refs/aip/run000000003/resolve-base',
    });
    expect(prepared.conflicts).toEqual(['app.ts']);
    expect(readFileSync(join(worktree, 'other.ts'), 'utf8')).toBe('other b\n');
    expect(readFileSync(join(worktree, 'added.ts'), 'utf8')).toBe('added by b\n');
    expect(filesWithMarkers(worktree, ['app.ts'])).toEqual(['app.ts']);
  });

  it('refuses a group that depends on a group left out, names it and changes nothing', async () => {
    // `c` changes the line `four` that only the left-out group `b` adds.
    const { repo, changes } = await setupGroups([
      ['c', (tree) => writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\nFOUR\n')],
    ]);
    const [a, , c] = changes;
    writeFileSync(join(repo, 'notes.md'), 'notes\n');
    const before = sh(repo, 'status', '--porcelain');
    for (const force of [false, true]) {
      await expect(deliver({ ...request(repo, a!), changes: [a!, c!], force })).rejects.toThrow(
        'the changes of group c do not apply on top of the groups before it',
      );
    }
    await expect(
      prepareResolve({
        repository: repo,
        worktree: join(repo, '..', 'resolve'),
        changes: [a!, c!],
        include: [],
        baseRef: 'refs/aip/run000000003/resolve-base',
      }),
    ).rejects.toThrow('group c');
    expect(sh(repo, 'status', '--porcelain')).toBe(before);
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('delivers three groups merged one after the other', async () => {
    const { repo, changes } = await setupGroups([
      ['c', (tree) => writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\nFOUR\n')],
    ]);
    const result = await deliver({ ...request(repo, changes[0]!), changes });
    expect(result).toMatchObject({ kind: 'applied', conflicts: [] });
    expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('one\nTWO\nthree\nFOUR\n');
    expect(readFileSync(join(repo, 'added.ts'), 'utf8')).toBe('added by b\n');
  });
});

describe('diff statistics', () => {
  it('counts added and removed lines per file, binary files and renames', async () => {
    const { repo, change } = await setup((tree) => {
      writeFileSync(join(tree, 'app.ts'), 'one\nTWO\nthree\nfour\n');
      writeFileSync(join(tree, 'logo.bin'), Buffer.from([0, 9, 9]));
      execFileSync('git', ['mv', 'old.ts', 'renamed.ts'], { cwd: tree });
    });
    expect(await diffStat(repo, change.from, change.to)).toEqual({
      files: [
        { path: 'app.ts', added: 2, removed: 1 },
        { path: 'logo.bin', added: null, removed: null },
        { path: 'renamed.ts', added: 0, removed: 0, previousPath: 'old.ts' },
      ],
      added: 2,
      removed: 1,
    });
  });
});

describe('file diff and range patch', () => {
  const numbered = (change?: number) =>
    Array.from({ length: 40 }, (_, i) => (i + 1 === change ? `changed ${i + 1}` : `line ${i + 1}`))
      .join('\n')
      .concat('\n');

  async function twoCommits(
    before: Record<string, string | Buffer>,
    after: Record<string, string | Buffer>,
    rename?: [string, string],
  ): Promise<{ repo: string; from: string; to: string }> {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'aip-diff-test-')));
    sh(repo, 'init', '-q', '-b', 'main');
    sh(repo, 'config', 'user.name', 'Test');
    sh(repo, 'config', 'user.email', 'test@example.com');
    for (const [name, data] of Object.entries(before)) writeFileSync(join(repo, name), data);
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'one');
    const from = sh(repo, 'rev-parse', 'HEAD');
    if (rename) sh(repo, 'mv', rename[0], rename[1]);
    for (const [name, data] of Object.entries(after)) writeFileSync(join(repo, name), data);
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'two');
    return { repo, from, to: sh(repo, 'rev-parse', 'HEAD') };
  }

  it('shows five lines of context around a change, without file headers', async () => {
    const { repo, from, to } = await twoCommits({ 'a.ts': numbered() }, { 'a.ts': numbered(20) });
    const diff = await fileDiff(repo, from, to, ['a.ts'], { context: 5, maxLines: 2000 });
    expect(diff.lines[0]).toMatch(/^@@ -15,11 \+15,11 @@/);
    expect(diff.lines).toContain('-line 20');
    expect(diff.lines).toContain('+changed 20');
    expect(diff.lines.some((line) => line.startsWith('diff --git'))).toBe(false);
    expect(diff.truncated).toBe(false);
    expect(diff.totalLines).toBe(diff.lines.length);
  });

  it('gives one hunk for a rename with an edit', async () => {
    const { repo, from, to } = await twoCommits(
      { 'old.ts': numbered() },
      { 'new.ts': numbered(20) },
      ['old.ts', 'new.ts'],
    );
    const diff = await fileDiff(repo, from, to, ['old.ts', 'new.ts'], {
      context: 5,
      maxLines: 2000,
    });
    expect(diff.lines.filter((line) => line.startsWith('@@'))).toHaveLength(1);
  });

  it('truncates past the line limit', async () => {
    const { repo, from, to } = await twoCommits({ 'a.ts': numbered() }, { 'a.ts': numbered(20) });
    const diff = await fileDiff(repo, from, to, ['a.ts'], { context: 5, maxLines: 4 });
    expect(diff.lines).toHaveLength(4);
    expect(diff.truncated).toBe(true);
    expect(diff.totalLines).toBeGreaterThan(4);
  });

  it('builds a patch that applies on the base and keeps binary and Latin-1 bytes', async () => {
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const binary = Buffer.from([0, 1, 2, 255, 254]);
    const { repo, from, to } = await twoCommits(
      { 'a.txt': 'x\n' },
      { 'latin.txt': latin, 'logo.bin': binary },
    );
    const patch = await rangePatch(repo, from, to);
    const clone = realpathSync(mkdtempSync(join(tmpdir(), 'aip-diff-clone-')));
    sh(clone, 'init', '-q', '-b', 'main');
    sh(clone, 'config', 'user.name', 'Test');
    sh(clone, 'config', 'user.email', 'test@example.com');
    writeFileSync(join(clone, 'a.txt'), 'x\n');
    sh(clone, 'add', '-A');
    sh(clone, 'commit', '-q', '-m', 'base');
    const file = join(clone, '..', `${Date.now()}.patch`);
    writeFileSync(file, patch);
    sh(clone, 'apply', '--check', file);
    sh(clone, 'apply', file);
    expect(readFileSync(join(clone, 'latin.txt')).equals(latin)).toBe(true);
    expect(readFileSync(join(clone, 'logo.bin')).equals(binary)).toBe(true);
  });
});
