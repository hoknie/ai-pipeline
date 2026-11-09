import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from '../../src/presentation/ipc/contract/index.ts';

import { harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

function newRepository(name: string): string {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-project-'))), name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  return repo;
}

async function list(h: Harness): Promise<RepositoryView[]> {
  return (await h.call('repositories', {})) as RepositoryView[];
}

/** `repository_move` while the home directory of the in-process daemon is `home`. */
async function moveWithHome(
  h: Harness,
  home: string,
  path: string,
  to: string,
): Promise<RepositoryView[]> {
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    return (await h.call('repository_move', { path, to })) as RepositoryView[];
  } finally {
    process.env.HOME = saved;
  }
}

describe('project slug', () => {
  it('addresses a project of the registry and never adds an unknown one', async () => {
    const h = (current = await harness());
    const app = newRepository('app');
    await h.call('repository_add', { path: app });
    const queue = (await h.call('queue', { repository: 'app' })) as QueueView;
    expect(queue.repository).toBe(app);
    await expect(h.call('queue', { repository: 'nope' })).rejects.toThrow('unknown project `nope`');
    expect((await list(h)).map((entry) => entry.path)).toEqual([app]);
  });
});

describe('project move', () => {
  it('moves the runs, the tags and the attributes of a finished project to a new root', async () => {
    const h = (current = await harness());
    await h.call('repository_add', { path: h.repo });
    await h.call('repository_update', { path: h.repo, name: 'Shop', color: 'teal' });
    const { slug } = (await list(h))[0]!;
    await h.call('tag_add', { repository: h.repo, name: 'auth' });
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'x' });
    await h.waitFor(runId, (view) => view.finished);
    const target = newRepository('moved');
    const moved = (await h.call('repository_move', {
      path: slug,
      to: join(target, '.'),
    })) as RepositoryView[];
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ path: target, slug, name: 'Shop', color: 'teal' });
    const runs = (await h.call('status', {})) as RunView[];
    expect(runs.find((view) => view.id === runId)?.repository).toBe(target);
    const tags = (await h.call('tags', { repository: target })) as TagView[];
    expect(tags.map((tag) => tag.name)).toContain('auth');
    await h.restart();
    expect((await list(h)).map((entry) => entry.path)).toEqual([target]);
    expect((await h.status(runId)).repository).toBe(target);
  });

  it('moves a project whose directory is gone, with the tasks of its queue, to a path under ~', async () => {
    const h = (current = await harness());
    // a copy of the harness repository: the queue needs its pipelines
    const old = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-project-'))), 'old');
    execFileSync('cp', ['-R', h.repo, old]);
    await h.call('repository_add', { path: old });
    await h.call('queue_add', { repository: old, pipeline: 'feature', task: 'A' });
    const target = join(dirname(old), 'new');
    renameSync(old, target);
    // a project of the registry answers without git, though its directory is gone
    const before = (await h.call('queue', { repository: old })) as QueueView;
    expect(before.items).toHaveLength(1);
    const home = dirname(dirname(old));
    const relative = target.slice(home.length + 1);
    const moved = await moveWithHome(h, home, old, `~/${relative}`);
    expect(moved.map((entry) => entry.path)).toEqual([target]);
    const after = (await h.call('queue', { repository: target })) as QueueView;
    expect(after.items).toHaveLength(1);
  });

  it('refuses a project with an unfinished run and a root already in the registry', async () => {
    const h = (current = await harness());
    h.script({ code: [{ waitFor: h.gate('a') }, {}] });
    await h.call('repository_add', { path: h.repo });
    const other = newRepository('other');
    await h.call('repository_add', { path: other });
    await expect(h.call('repository_move', { path: h.repo, to: other })).rejects.toThrow(
      `repository ${other} is already registered`,
    );
    const { runId } = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'x' });
    await expect(
      h.call('repository_move', { path: h.repo, to: newRepository('next') }),
    ).rejects.toThrow('repository has unfinished runs: 1');
    expect((await list(h)).map((entry) => entry.path).sort()).toEqual([h.repo, other].sort());
    h.open('a');
    await h.waitFor(runId, (view) => view.finished);
  });
});
