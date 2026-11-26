import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { searchLocalBranches } from '../../src/platform/git/branches.ts';

describe('local branch search', () => {
  it('filters and bounds local branches without exposing remote or internal refs', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'aip-branches-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Test');
      git('config', 'user.email', 'test@example.com');
      git('commit', '--allow-empty', '-q', '-m', 'base');
      const head = git('rev-parse', 'HEAD');
      for (let i = 0; i < 55; i++) {
        git('update-ref', `refs/heads/feature/${String(i).padStart(2, '0')}`, head);
      }
      git('update-ref', 'refs/remotes/origin/feature/remote', head);
      git('update-ref', 'refs/aip/feature/internal', head);

      const found = await searchLocalBranches(repo, 'feature/');
      expect(found).toHaveLength(50);
      expect(found[0]).toBe('feature/00');
      expect(found[49]).toBe('feature/49');
      expect(await searchLocalBranches(repo, 'remote')).toEqual([]);
      expect(await searchLocalBranches(repo, 'internal')).toEqual([]);
      expect(await searchLocalBranches(repo, 'ure/54')).toEqual(['feature/54']);
      expect(await searchLocalBranches(repo, 'feature/5', true)).toEqual([]);
      expect(await searchLocalBranches(repo, 'feature/54', true)).toEqual(['feature/54']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
