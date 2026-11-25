import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { conflictsOnBase, type GroupChange } from '../../src/platform/git/index.ts';

const directories: string[] = [];

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(): string {
  const repo = mkdtempSync(join(tmpdir(), 'aip-probe-check-'));
  directories.push(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'lib.ts'), 'export const value = 1;\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}

function commitFile(repo: string, branch: string, file: string, content: string): string {
  sh(repo, 'checkout', '-q', '-B', branch, 'main');
  writeFileSync(join(repo, file), content);
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', branch);
  return sh(repo, 'rev-parse', 'HEAD');
}

function change(group: string, commit: string): GroupChange {
  return { group, from: `${commit}^1`, to: commit };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('the isolated check of a delivery on a base commit', () => {
  it('names the files two changes both touch, and never moves the worktree', async () => {
    const repo = repository();
    const first = commitFile(repo, 'first', 'lib.ts', 'export const value = "a";\n');
    const second = commitFile(repo, 'second', 'lib.ts', 'export const value = "b";\n');
    sh(repo, 'checkout', '-q', 'main');
    const head = sh(repo, 'rev-parse', 'HEAD');
    const before = readFileSync(join(repo, 'lib.ts'), 'utf8');
    const conflicts = await conflictsOnBase(repo, head, [
      change('first', first),
      change('second', second),
    ]);
    expect(conflicts).toEqual(['lib.ts']);
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(repo, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(repo, 'lib.ts'), 'utf8')).toBe(before);
  });

  it('applies changes of different files cleanly', async () => {
    const repo = repository();
    const first = commitFile(repo, 'first', 'lib.ts', 'export const value = 2;\n');
    const second = commitFile(repo, 'second', 'other.ts', 'export const other = true;\n');
    sh(repo, 'checkout', '-q', 'main');
    const conflicts = await conflictsOnBase(repo, sh(repo, 'rev-parse', 'HEAD'), [
      change('first', first),
      change('second', second),
    ]);
    expect(conflicts).toEqual([]);
    expect(sh(repo, 'status', '--porcelain')).toBe('');
  });
});
