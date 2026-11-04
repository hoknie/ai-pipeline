import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RepositoryView, RunCreated } from '../../src/protocol/index.ts';

import { harness, startRun, type Harness } from './harness.ts';

// Each test needs a fresh daemon: the registry of repositories belongs to the daemon.
let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

function newRepository(): string {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-registry-'))), 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  mkdirSync(join(repo, 'sub'));
  return repo;
}

async function list(h: Harness): Promise<RepositoryView[]> {
  return (await h.call('repositories', {})) as RepositoryView[];
}

async function paths(h: Harness): Promise<string[]> {
  return (await list(h)).map((entry) => entry.path);
}

describe('repository registry', () => {
  it('is empty until a repository is requested', async () => {
    const h = (current = await harness());
    expect(await list(h)).toEqual([]);
  });

  it('learns repositories from config, config_preview and queue requests', async () => {
    const h = (current = await harness());
    const viewed = newRepository();
    await h.call('config', { repository: join(viewed, 'sub') });
    expect(await paths(h)).toEqual([viewed]);
    const previewed = newRepository();
    await h.call('config_preview', {
      repository: previewed,
      kind: 'workflow',
      id: 'feature',
      value: { steps: [] },
    });
    const queued = newRepository();
    await h.call('queue', { repository: queued });
    expect(await paths(h)).toEqual([viewed, previewed, queued].sort());
  });

  it('keeps the registry after a restart', async () => {
    const h = (current = await harness());
    await h.call('workflows', { repository: h.repo });
    await h.restart();
    expect(await paths(h)).toEqual([h.repo]);
  });

  it('adds a repository by a subdirectory, once, and refuses a path outside git', async () => {
    const h = (current = await harness());
    const repo = newRepository();
    const added = (await h.call('repository_add', { path: join(repo, 'sub') })) as RepositoryView[];
    expect(added).toEqual([
      { path: repo, addedAt: expect.any(Number), unfinished: 0, waiting: 0, queued: 0 },
    ]);
    const again = (await h.call('repository_add', { path: repo })) as RepositoryView[];
    expect(again).toEqual(added);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'aip-outside-')));
    await expect(h.call('repository_add', { path: outside })).rejects.toThrow();
    await expect(h.call('repository_add', { path: join(outside, 'missing') })).rejects.toThrow();
    expect(await paths(h)).toEqual([repo]);
  });

  it('refuses removal while a run is unfinished and allows it after the run ends', async () => {
    const h = (current = await harness());
    h.script({ code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    expect(await list(h)).toMatchObject([{ path: h.repo, unfinished: 1, waiting: 1 }]);
    await expect(h.call('repository_remove', { path: h.repo })).rejects.toThrow(
      'repository has unfinished runs: 1',
    );
    await h.call('cancel', { runId });
    await h.waitFor(runId, (view) => view.finished);
    expect(await h.call('repository_remove', { path: h.repo })).toEqual([]);
    expect((await h.status(runId)).id).toBe(runId);
  });

  it('does not mind an empty queue that is paused', async () => {
    const h = (current = await harness());
    const paused = newRepository();
    await h.call('queue_start', { repository: paused });
    await h.call('queue_pause', { repository: paused });
    expect(await paths(h)).toContain(paused);
    await h.call('repository_remove', { path: paused });
    expect(await paths(h)).not.toContain(paused);
  });

  it('refuses a queue with a task', async () => {
    const h = (current = await harness());
    await h.call('queue_add', { repository: h.repo, workflow: 'feature', task: 'A' });
    await expect(h.call('repository_remove', { path: h.repo })).rejects.toThrow(
      'repository queue is not empty or running',
    );
  });

  it('refuses an unknown repository and removes one whose directory is gone', async () => {
    const h = (current = await harness());
    const stranger = newRepository();
    await expect(h.call('repository_remove', { path: stranger })).rejects.toThrow(
      `unknown repository ${stranger}`,
    );
    const gone = newRepository();
    await h.call('repository_add', { path: gone });
    rmSync(gone, { recursive: true, force: true });
    expect(await h.call('repository_remove', { path: gone })).toEqual([]);
  });
});
