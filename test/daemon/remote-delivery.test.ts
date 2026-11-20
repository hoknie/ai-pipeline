import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ApplyResult,
  QueueView,
  RunCreated,
} from '../../src/presentation/ipc/contract/index.ts';

import { CODE_ONLY_CONFIG, git, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SERVER = 'server: { enabled: true, public_url: "https://aip.example.com" }\n';

interface Remote {
  h: Harness;
  /** The bare repository the clone of the server pushes to. */
  bare: string;
  /** Another clone of it: the colleague of the user. */
  colleague: string;
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A server daemon whose project has a bare `origin`, and a colleague who pushes to it. */
async function start(delivery = ''): Promise<Remote> {
  const h = await harness(`${CODE_ONLY_CONFIG}${delivery}`);
  current = h;
  const directory = join(String(h.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'settings.yaml'), SERVER);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-origin-')));
  const bare = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  sh(h.repo, 'remote', 'add', 'origin', bare);
  sh(h.repo, 'push', '-q', 'origin', 'main');
  const colleague = join(base, 'colleague');
  execFileSync('git', ['clone', '-q', bare, colleague], { stdio: 'ignore' });
  sh(colleague, 'config', 'user.name', 'Colleague');
  sh(colleague, 'config', 'user.email', 'colleague@example.com');
  return { h, bare, colleague };
}

function colleagueCommits(remote: Remote, text: string): string {
  writeFileSync(join(remote.colleague, 'colleague.ts'), `${text}\n`);
  sh(remote.colleague, 'add', '.');
  sh(remote.colleague, 'commit', '-qm', text);
  sh(remote.colleague, 'push', '-q', 'origin', 'main');
  return sh(remote.colleague, 'rev-parse', 'HEAD');
}

const WRITE_LIB = { code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] };

async function finishedRun(h: Harness): Promise<string> {
  const { runId } = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups: [{ title: 'Login', task: 'login' }],
  })) as RunCreated;
  await h.waitFor(runId, (view) => view.finished);
  return runId;
}

/** The run is delivered and its branch is in origin. */
async function pushedRun(h: Harness): Promise<string> {
  const runId = await finishedRun(h);
  await until('the push', async () => (await h.status(runId)).remoteBranch !== null);
  return runId;
}

describe('a run in the server mode starts from a fresh remote base', () => {
  it('takes the commit a colleague pushed after the last run', async () => {
    const remote = await start();
    const { h } = remote;
    h.script(WRITE_LIB);
    const head = sh(h.repo, 'rev-parse', 'HEAD');
    const colleagueCommit = colleagueCommits(remote, 'colleague work');
    const runId = await pushedRun(h);
    // the clone of the server is not touched: its HEAD and working tree stay where they were
    expect(sh(h.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(h.repo, 'status', '--porcelain')).toBe('');
    const branch = `aip/${runId}`;
    expect(git(remote.bare, 'merge-base', '--is-ancestor', colleagueCommit, branch)).toBe('');
    expect(git(remote.bare, 'show', `${branch}:colleague.ts`)).toBe('colleague work');
    expect(git(remote.bare, 'show', `${branch}:lib.ts`)).toBe('export const value = 2;');
  });

  it('ignores the uncommitted changes of the clone of the server', async () => {
    const remote = await start();
    const { h } = remote;
    h.script(WRITE_LIB);
    writeFileSync(join(h.repo, 'stray.ts'), 'stray\n');
    const runId = await pushedRun(h);
    expect(git(remote.bare, 'ls-tree', '--name-only', `aip/${runId}`)).not.toContain('stray.ts');
  });

  it('keeps the task in the queue with the text of git when the remote is unreachable', async () => {
    const remote = await start();
    const { h } = remote;
    sh(h.repo, 'remote', 'set-url', 'origin', join(remote.bare, 'nonexistent'));
    await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await h.call('queue_start', { repository: h.repo });
    await until('the error of the task', async () => {
      const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
      return queue.items.some((item) => item.error !== null);
    });
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.error).toMatch(/git ls-remote --symref origin HEAD failed/);
    expect(queue.items[0]?.error).toContain('does not appear to be a git repository');
    expect((await h.call('status', {})) as unknown[]).toEqual([]);
  });

  it('refuses a task in the worktree mode', async () => {
    const { h } = await start();
    await expect(
      h.call('run', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'x',
        deliveryMode: 'worktree',
      }),
    ).rejects.toThrow(/aip run apply/);
  });
});

describe('the branch of a delivery in the server mode', () => {
  it('goes to origin when the run is delivered, and the answer names it', async () => {
    const { h, bare } = await start();
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await until('the push', async () => (await h.status(runId)).remoteBranch !== null);
    const view = await h.status(runId);
    expect(view.remoteBranch).toEqual({
      remote: 'origin',
      branch: `aip/${runId}`,
      url: null,
      address: bare,
    });
    expect(git(bare, 'rev-parse', `aip/${runId}`)).toBe(git(h.repo, 'rev-parse', `aip/${runId}`));
    expect(git(bare, 'rev-parse', 'main')).toBe(git(h.repo, 'rev-parse', 'main'));
    expect(view.delivery).toMatchObject({ applied: 1, merged: 1, failed: 0 });
  });

  it('is push_failed when origin holds a branch with another history, and a retry sends it', async () => {
    const remote = await start();
    const { h, bare, colleague } = remote;
    h.script(WRITE_LIB);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'login' }],
    })) as RunCreated;
    // somebody took the name of the branch before the run was delivered
    writeFileSync(join(colleague, 'other.ts'), 'other\n');
    sh(colleague, 'add', '.');
    sh(colleague, 'commit', '-qm', 'other');
    sh(colleague, 'push', '-q', 'origin', `HEAD:refs/heads/aip/${runId}`);
    const theirs = git(bare, 'rev-parse', `aip/${runId}`);
    await until('the failed push', async () => {
      const view = await h.status(runId);
      return view.deliveryStage?.status === 'push_failed';
    });
    const failed = await h.status(runId);
    expect(failed.deliveryStage).toMatchObject({
      status: 'push_failed',
      groups: ['login'],
      reason: expect.stringContaining('rejected'),
    });
    expect(failed.remoteBranch).toBeNull();
    expect(failed.state).toBe('failed');
    // the branch of the server is kept, and the branch of origin is as it was
    expect(git(h.repo, 'branch', '--list', `aip/${runId}`)).not.toBe('');
    expect(git(bare, 'rev-parse', `aip/${runId}`)).toBe(theirs);
    // the name is free again: apply repeats only the push
    sh(bare, 'update-ref', '-d', `refs/heads/aip/${runId}`);
    const result = (await h.call('apply', { runId })) as ApplyResult;
    expect(result.groups[0]?.delivery.state).toBe('applied');
    expect(git(bare, 'rev-parse', `aip/${runId}`)).toBe(git(h.repo, 'rev-parse', `aip/${runId}`));
    const done = await h.status(runId);
    expect(done.remoteBranch?.branch).toBe(`aip/${runId}`);
    expect(done.delivery).toMatchObject({ applied: 1, merged: 1 });
  });

  it('is push_failed without access to origin, and the branch of the server stays', async () => {
    const { h, bare } = await start();
    h.script(WRITE_LIB);
    sh(h.repo, 'remote', 'set-url', '--push', 'origin', join(bare, 'nonexistent'));
    const runId = await finishedRun(h);
    await until('the failed push', async () => {
      return (await h.status(runId)).deliveryStage?.status === 'push_failed';
    });
    expect(git(h.repo, 'branch', '--list', `aip/${runId}`)).not.toBe('');
    sh(h.repo, 'remote', 'set-url', '--push', 'origin', bare);
    await h.call('apply', { runId });
    expect(git(bare, 'rev-parse', `aip/${runId}`)).toBe(git(h.repo, 'rev-parse', `aip/${runId}`));
  });

  it('is not sent with delivery.push: false', async () => {
    const { h, bare } = await start('  delivery: { push: false }\n');
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await until('the delivery', async () => (await h.status(runId)).delivery.applied === 1);
    expect(git(bare, 'branch', '--list', 'aip/*')).toBe('');
    expect((await h.status(runId)).remoteBranch).toBeNull();
  });
});
