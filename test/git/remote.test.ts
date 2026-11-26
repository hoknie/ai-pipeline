import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fetchBranch,
  findRemote,
  prepareRunBranch,
  pushBranch,
  remoteHead,
  remoteUrl,
  resolveBase,
} from '../../src/platform/git/index.ts';

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A clone whose `origin` is a bare repository; `other` is a second clone of the same remote. */
function setup(): { bare: string; repo: string; other: string; commit: (to: string) => string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-remote-test-')));
  const bare = join(base, 'remote.git');
  const repo = join(base, 'repo');
  const other = join(base, 'other');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, repo], { stdio: 'ignore' });
  for (const dir of [repo]) {
    sh(dir, 'config', 'user.name', 'Test');
    sh(dir, 'config', 'user.email', 'test@example.com');
  }
  writeFileSync(join(repo, 'app.ts'), 'one\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'first');
  sh(repo, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', bare, other], { stdio: 'ignore' });
  sh(other, 'config', 'user.name', 'Other');
  sh(other, 'config', 'user.email', 'other@example.com');
  const commit = (to: string): string => {
    writeFileSync(join(other, 'app.ts'), `${to}\n`);
    sh(other, 'commit', '-qam', to);
    sh(other, 'push', '-q', 'origin', 'main');
    return sh(other, 'rev-parse', 'HEAD');
  };
  return { bare, repo, other, commit };
}

describe('the remote of a repository', () => {
  it('names the main branch the remote HEAD points to', async () => {
    const { repo } = setup();
    expect(await remoteHead(repo, 'origin')).toBe('main');
  });

  it('fetches the tip of a branch a colleague just pushed', async () => {
    const { repo, commit } = setup();
    const tip = commit('second');
    expect(await fetchBranch(repo, 'origin', 'main')).toBe(tip);
    expect(sh(repo, 'rev-parse', 'refs/remotes/origin/main')).toBe(tip);
  });

  it('resolves the base from the remote HEAD or from a named branch', async () => {
    const { repo, other, commit } = setup();
    sh(other, 'push', '-q', 'origin', 'HEAD:refs/heads/develop');
    const tip = commit('second');
    expect(await resolveBase(repo, 'origin', null)).toEqual({ branch: 'main', commit: tip });
    const develop = await resolveBase(repo, 'origin', 'develop');
    expect(develop.branch).toBe('develop');
    expect(develop.commit).not.toBe(tip);
  });

  it('starts a run branch from the fetched commit, not from HEAD', async () => {
    const { repo, commit } = setup();
    const tip = commit('second');
    const { commit: fetched } = await resolveBase(repo, 'origin', null);
    const prepared = await prepareRunBranch(repo, 'refs/aip/r1/run', {
      workingTree: false,
      include: [],
      snapshotRef: null,
      commit: fetched,
    });
    expect(prepared).toEqual({
      baseCommit: tip,
      dirty: false,
      sourceCommit: null,
      sourceBranch: null,
    });
    expect(sh(repo, 'rev-parse', 'refs/aip/r1/run')).toBe(tip);
    expect(sh(repo, 'rev-parse', 'HEAD')).not.toBe(tip);
  });

  it('fails with the text of git when the remote cannot be reached', async () => {
    const { repo } = setup();
    sh(repo, 'remote', 'set-url', 'origin', '/nonexistent/remote.git');
    await expect(resolveBase(repo, 'origin', null)).rejects.toThrow(/nonexistent/);
    await expect(fetchBranch(repo, 'origin', 'main')).rejects.toThrow(/git fetch/);
  });

  it('finds the remote with an address and reads its URL', async () => {
    const { repo, bare } = setup();
    sh(repo, 'remote', 'add', 'upstream', 'git@example.com:acme/app.git');
    expect(await remoteUrl(repo, 'origin')).toBe(bare);
    expect(await findRemote(repo, (url) => url.includes('acme/app'))).toBe('upstream');
    expect(await findRemote(repo, (url) => url.includes('nothing'))).toBeNull();
  });
});

describe('pushing the branch of a delivery', () => {
  it('sends it to the remote under its own name and touches nothing else', async () => {
    const { bare, repo } = setup();
    sh(repo, 'branch', 'aip/mx1');
    const mainBefore = sh(bare, 'rev-parse', 'main');
    expect(await pushBranch(repo, 'origin', 'aip/mx1')).toEqual({ ok: true });
    expect(sh(bare, 'rev-parse', 'aip/mx1')).toBe(sh(repo, 'rev-parse', 'aip/mx1'));
    expect(sh(bare, 'rev-parse', 'main')).toBe(mainBefore);
    // nothing new to send is not a failure
    expect(await pushBranch(repo, 'origin', 'aip/mx1')).toEqual({ ok: true });
  });

  it('refuses a branch with another history and leaves the remote branch as it is', async () => {
    const { bare, repo, other } = setup();
    writeFileSync(join(other, 'app.ts'), 'theirs\n');
    sh(other, 'commit', '-qam', 'theirs');
    sh(other, 'push', '-q', 'origin', 'HEAD:refs/heads/aip/mx1');
    const theirs = sh(bare, 'rev-parse', 'aip/mx1');
    writeFileSync(join(repo, 'app.ts'), 'mine\n');
    sh(repo, 'commit', '-qam', 'mine');
    sh(repo, 'branch', 'aip/mx1');
    const result = await pushBranch(repo, 'origin', 'aip/mx1');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(/rejected/);
    expect(sh(bare, 'rev-parse', 'aip/mx1')).toBe(theirs);
  });

  it('reports a remote that cannot be reached', async () => {
    const { repo } = setup();
    sh(repo, 'branch', 'aip/mx1');
    sh(repo, 'remote', 'set-url', 'origin', '/nonexistent/remote.git');
    const result = await pushBranch(repo, 'origin', 'aip/mx1');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('nonexistent');
  });
});
