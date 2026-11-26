import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { queueOf, start } from './queue-harness.ts';

it('searches only local branches of the requested registered project', async () => {
  const h = await start();
  const other = mkdtempSync(join(tmpdir(), 'aip-branch-project-'));
  const git = (repo: string, ...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    await queueOf(h); // Register the harness repository.
    git(h.repo, 'branch', 'feature/first');
    const head = git(h.repo, 'rev-parse', 'HEAD');
    git(h.repo, 'update-ref', 'refs/remotes/origin/feature/remote', head);
    git(h.repo, 'update-ref', 'refs/aip/feature/internal', head);
    git(other, 'init', '-q', '-b', 'main');
    git(other, 'config', 'user.name', 'Test');
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'commit', '--allow-empty', '-q', '-m', 'base');
    git(other, 'branch', 'feature/second');
    await h.call('repository_add', { path: other });

    expect(await h.call('repository_branches', { repository: h.repo, query: 'feature/' })).toEqual([
      'feature/first',
    ]);
    expect(await h.call('repository_branches', { repository: other, query: 'feature/' })).toEqual([
      'feature/second',
    ]);
    await expect(
      h.call('repository_branches', { repository: join(h.repo, 'unknown'), query: '' }),
    ).rejects.toThrow('unknown repository');
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});
