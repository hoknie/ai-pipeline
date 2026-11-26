import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { observeGit, prepareRunBranch } from '../../src/platform/git/index.ts';

function repo(): string {
  const path = mkdtempSync(join(tmpdir(), 'aip-source-'));
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'user.name', 'Test');
  git(path, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(path, 'file'), 'base\n');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'base');
  return path;
}

function git(path: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: path, encoding: 'utf8' }).trim();
}

afterEach(() => observeGit(null));

describe('run source snapshot', () => {
  it('records the actual source branch and commit as the parent of the snapshot', async () => {
    const path = repo();
    const head = git(path, 'rev-parse', 'HEAD');
    writeFileSync(join(path, 'file'), 'changed\n');
    const prepared = await prepareRunBranch(path, 'refs/aip/test/run', {
      workingTree: true,
      include: [],
      snapshotRef: 'refs/aip/test/base',
    });
    expect(prepared).toMatchObject({ sourceCommit: head, sourceBranch: 'main' });
    expect(prepared.baseCommit).not.toBe(head);
    expect(git(path, 'rev-parse', `${prepared.baseCommit}^`)).toBe(head);
  });

  it('records a detached source without inventing a branch', async () => {
    const path = repo();
    const head = git(path, 'rev-parse', 'HEAD');
    git(path, 'update-ref', '--no-deref', 'HEAD', head);
    const prepared = await prepareRunBranch(path, 'refs/aip/test/run');
    expect(prepared).toMatchObject({ baseCommit: head, sourceCommit: head, sourceBranch: null });
  });

  it('records the branch name without ambiguity when a tag has the same name', async () => {
    const path = repo();
    git(path, 'tag', 'main');
    expect(git(path, 'symbolic-ref', '--short', 'HEAD')).toBe('heads/main');
    const prepared = await prepareRunBranch(path, 'refs/aip/test/run');
    expect(prepared.sourceBranch).toBe('main');
  });

  it('refuses a HEAD change during snapshot before writing run or snapshot refs', async () => {
    const path = repo();
    writeFileSync(join(path, 'file'), 'changed\n');
    let changed = false;
    observeGit(({ cwd, args }) => {
      if (cwd === path && args[0] === 'read-tree' && !changed) {
        changed = true;
        git(path, 'commit', '--allow-empty', '-qm', 'concurrent');
      }
    });
    await expect(
      prepareRunBranch(path, 'refs/aip/test/run', {
        workingTree: true,
        include: [],
        snapshotRef: 'refs/aip/test/base',
      }),
    ).rejects.toThrow(/HEAD or its branch changed/);
    expect(changed).toBe(true);
    expect(git(path, 'for-each-ref', '--format=%(refname)', 'refs/aip/test/')).toBe('');
  });

  it('detects a checkout at the same commit', async () => {
    const path = repo();
    git(path, 'branch', 'other');
    let changed = false;
    observeGit(({ cwd, args }) => {
      if (cwd === path && args[0] === 'status' && !changed) {
        changed = true;
        git(path, 'symbolic-ref', 'HEAD', 'refs/heads/other');
      }
    });
    await expect(prepareRunBranch(path, 'refs/aip/test/run')).rejects.toThrow(
      /HEAD or its branch changed/,
    );
    expect(git(path, 'for-each-ref', '--format=%(refname)', 'refs/aip/test/')).toBe('');
  });
});
