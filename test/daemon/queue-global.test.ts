import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  GlobalQueueView,
  QueueView,
  RepositoryView,
} from '../../src/presentation/ipc/contract/index.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { CODE_ONLY_CONFIG, settle, until, type Harness } from './harness.ts';
import { allRuns, start, stop } from './queue-harness.ts';

type AnyQueue = QueueView | GlobalQueueView;

/** The shared settings.yaml of the daemon: the mode of the queue is set there. */
function writeScope(h: Harness, queue: string): void {
  const directory = join(h.environment.XDG_CONFIG_HOME!, 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'settings.yaml'), `queue: ${queue}\n`);
}

/** A second project of the daemon: a copy of the template repository with the same config. */
async function lib(h: Harness): Promise<string> {
  const path = join(dirname(h.repo), 'lib');
  copyTemplateRepo(path, CODE_ONLY_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
  await h.call('repository_add', { path });
  return path;
}

const queueIn = async (h: Harness, repository: string): Promise<AnyQueue> =>
  (await h.call('queue', { repository })) as AnyQueue;

const globalOf = async (h: Harness): Promise<GlobalQueueView> => {
  const view = await queueIn(h, h.repo);
  if (view.scope !== 'global') throw new Error('the queue is not global');
  return view;
};

const projectOf = async (h: Harness, repository: string): Promise<QueueView> => {
  const view = await queueIn(h, repository);
  if (view.scope !== 'project') throw new Error('the queue is not of a project');
  return view;
};

/** Adds a task; tasks added one after another get different times, so the order is the same. */
async function addIn(
  h: Harness,
  repository: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<{ item: string }> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return (await h.call('queue_add', {
    repository,
    pipeline: 'feature',
    task: 'работа',
    title,
    ...extra,
  })) as { item: string };
}

const titles = (view: GlobalQueueView): string[] => view.items.map((item) => item.title ?? '');

const slugOf = async (h: Harness, path: string): Promise<string> =>
  ((await h.call('repositories', {})) as RepositoryView[]).find((entry) => entry.path === path)!
    .slug;

async function waitGlobal(
  h: Harness,
  done: (view: GlobalQueueView) => boolean,
): Promise<GlobalQueueView> {
  let last: GlobalQueueView | null = null;
  await until('the global queue', async () => {
    last = await globalOf(h);
    return done(last);
  });
  return last!;
}

describe('switching to the global mode', () => {
  it('pauses every queue and keeps the runs of the projects working', async () => {
    const h = await start();
    const other = await lib(h);
    const hold = { waitFor: h.gate('a') };
    h.script({ code: [hold, hold, {}] });
    await addIn(h, h.repo, 'A');
    await addIn(h, other, 'B');
    await addIn(h, h.repo, 'C');
    await h.call('queue_start', { repository: h.repo });
    await h.call('queue_start', { repository: other });
    const before = await projectOf(h, h.repo);
    expect(before.runs).toHaveLength(1);
    expect(before.status).toBe('running');
    expect((await projectOf(h, other)).status).toBe('running');

    writeScope(h, '{ scope: global }');
    const view = await globalOf(h);
    expect(view.status).toBe('stopped');
    expect(view.runs.map((run) => run.repository).sort()).toEqual([h.repo, other].sort());
    expect(titles(view)).toEqual(['C']);
    expect(view.items[0]).toMatchObject({ repository: h.repo, position: 1 });
    const runs = await allRuns(h);
    expect(runs.every((run) => !run.finished)).toBe(true);
    h.open('a');
    for (const run of runs) await h.waitFor(run.id, (view) => view.finished);
  });

  it('works in the global mode after a restart with the setting written while the daemon was down', async () => {
    const h = await start();
    const other = await lib(h);
    await addIn(h, h.repo, 'A');
    await addIn(h, h.repo, 'B');
    await h.call('queue_settings', { repository: other, autopilot: true });
    expect((await projectOf(h, other)).status).toBe('running');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.restart(() => writeScope(h, '{ scope: global }'));
    const view = await globalOf(h);
    expect(view.status).toBe('stopped');
    expect(titles(view)).toEqual(['A', 'B']);
    // the queues of the projects keep their settings
    writeScope(h, '{ scope: project }');
    const app = await projectOf(h, h.repo);
    expect(app.parallel).toBe(2);
    expect(app.status).toBe('stopped');
    expect((await projectOf(h, other)).status).toBe('stopped');
  });

  it('keeps the settings of the projects while the global queue has its own', async () => {
    const h = await start();
    const other = await lib(h);
    await h.call('queue_settings', { repository: h.repo, parallel: 3 });
    await addIn(h, other, 'B');
    writeScope(h, '{ scope: global }');
    expect((await globalOf(h)).parallel).toBe(1);
    const changed = (await h.call('queue_settings', {
      repository: other,
      parallel: 1,
      autopilot: true,
    })) as GlobalQueueView;
    expect(changed).toMatchObject({ scope: 'global', parallel: 1, autopilot: true });
    writeScope(h, '{ scope: project }');
    expect(await projectOf(h, h.repo)).toMatchObject({ parallel: 3, autopilot: false });
    expect(await projectOf(h, other)).toMatchObject({ parallel: 1, autopilot: false });
  });

  it('puts the tasks back into the queues of their projects in their global order', async () => {
    const h = await start();
    const other = await lib(h);
    const a = await addIn(h, h.repo, 'A');
    await addIn(h, other, 'B');
    const c = await addIn(h, h.repo, 'C');
    writeScope(h, '{ scope: global }');
    expect(titles(await globalOf(h))).toEqual(['A', 'B', 'C']);
    // C goes through the projects to the first place
    const moved = (await h.call('queue_edit', {
      repository: h.repo,
      item: c.item,
      position: 1,
    })) as GlobalQueueView;
    expect(titles(moved)).toEqual(['C', 'A', 'B']);
    expect(moved.items.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(moved.items.find((item) => item.id === a.item)?.repository).toBe(h.repo);
    await expect(
      h.call('queue_edit', { repository: h.repo, item: c.item, position: 4 }),
    ).rejects.toThrow('position must be an integer from 1 to 3');
    writeScope(h, '{ scope: project }');
    expect((await projectOf(h, h.repo)).items.map((item) => item.title)).toEqual(['C', 'A']);
    expect((await projectOf(h, other)).items.map((item) => item.title)).toEqual(['B']);
  });

  it('edits and removes a task of another project through the queue of any project', async () => {
    const h = await start();
    const other = await lib(h);
    await addIn(h, h.repo, 'A');
    const b = await addIn(h, other, 'B');
    const c = await addIn(h, other, 'C');
    writeScope(h, '{ scope: global }');
    const moved = (await h.call('queue_edit', {
      repository: h.repo,
      item: c.item,
      position: 1,
    })) as GlobalQueueView;
    expect(titles(moved)).toEqual(['C', 'A', 'B']);
    await h.call('queue_remove', { repository: h.repo, item: b.item });
    expect(titles(await globalOf(h))).toEqual(['C', 'A']);
  });

  it('keeps the projects of the filter when the settings request is refused', async () => {
    const h = await start();
    const other = await lib(h);
    writeScope(h, '{ scope: global }');
    await expect(
      h.call('queue_settings', {
        repository: h.repo,
        parallel: 0,
        filter: { projects: [await slugOf(h, other)] },
      }),
    ).rejects.toThrow();
    expect((await globalOf(h)).filter.projects).toEqual([]);
  });

  it('ignores a wrong section and stays in the project mode', async () => {
    const h = await start();
    writeScope(h, '{ scope: all }');
    expect((await queueIn(h, h.repo)).scope).toBe('project');
  });
});

describe('the global queue moves', () => {
  it('has one parallel for all projects', async () => {
    const h = await start();
    const other = await lib(h);
    h.script({ code: [{ waitFor: h.gate('all') }] });
    writeScope(h, '{ scope: global }');
    await addIn(h, h.repo, 'A');
    await addIn(h, other, 'B');
    await addIn(h, h.repo, 'C');
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    const started = (await h.call('queue_start', { repository: h.repo })) as GlobalQueueView;
    expect(started.status).toBe('running');
    expect(started.runs.map((run) => run.repository).sort()).toEqual([h.repo, other].sort());
    expect(titles(started)).toEqual(['C']);
    h.open('all');
    const done = await waitGlobal(
      h,
      (view) => view.status === 'stopped' && view.items.length === 0,
    );
    expect(done.runs).toEqual([]);
    expect(await allRuns(h)).toHaveLength(3);
  });

  it('stops on the problem of a run of any project', async () => {
    const h = await start();
    const other = await lib(h);
    h.script({ code: [{ noReport: true }, {}] });
    writeScope(h, '{ scope: global }');
    await addIn(h, other, 'B');
    await addIn(h, h.repo, 'A');
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitGlobal(h, (view) => view.stop !== null);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stop).toMatchObject({ kind: 'problem', reason: 'failed' });
    await settle(h);
    expect(titles(await globalOf(h))).toEqual(['A']);
    expect((await allRuns(h)).map((run) => run.repository)).toEqual([other]);
  });

  it('does not take the tasks of a disabled project', async () => {
    const h = await start();
    const other = await lib(h);
    writeScope(h, '{ scope: global }');
    await addIn(h, other, 'A');
    await addIn(h, h.repo, 'B');
    await h.call('repository_update', { path: other, enabled: false });
    await h.call('queue_settings', { repository: h.repo, parallel: 1 });
    await h.call('queue_start', { repository: h.repo });
    const done = await waitGlobal(h, (view) => view.runs.length === 0 && view.items.length <= 1);
    expect(titles(done)).toEqual(['A']);
    expect((await allRuns(h)).map((run) => run.repository)).toEqual([h.repo]);
    expect(await slugOf(h, other)).toBeTruthy();
  });

  it('takes only the projects of its filter, which changes only while it is stopped', async () => {
    const h = await start();
    const other = await lib(h);
    writeScope(h, '{ scope: global }');
    await addIn(h, h.repo, 'A');
    await addIn(h, other, 'B');
    const slug = await slugOf(h, other);
    const filtered = (await h.call('queue_settings', {
      repository: h.repo,
      filter: { projects: [slug] },
    })) as GlobalQueueView;
    expect(filtered.filter).toEqual({ pipelines: [], projects: [other] });
    expect(filtered.items.map((item) => item.filtered)).toEqual([true, false]);
    await expect(
      h.call('queue_settings', { repository: h.repo, filter: { tags: ['x'] } }),
    ).rejects.toThrow('the global queue has no filter by tags');
    await h.call('queue_start', { repository: h.repo });
    const done = await waitGlobal(h, (view) => view.runs.length === 0 && view.status === 'stopped');
    expect(titles(done)).toEqual(['A']);
    await expect(
      h.call('queue_settings', { repository: h.repo, filter: { projects: [] } }),
    ).resolves.toBeTruthy();
  });

  it('adds a task of a project to the end of the global order with the number of its project', async () => {
    const h = await start();
    const other = await lib(h);
    writeScope(h, '{ scope: global }');
    await addIn(h, h.repo, 'A');
    await addIn(h, other, 'B');
    await addIn(h, h.repo, 'C');
    const view = await globalOf(h);
    expect(titles(view)).toEqual(['A', 'B', 'C']);
    expect(view.items.map((item) => [item.repository, item.number])).toEqual([
      [h.repo, 1],
      [other, 1],
      [h.repo, 2],
    ]);
    const answer = (await h.call('queue', { repository: other })) as GlobalQueueView;
    expect(answer.scope).toBe('global');
    expect(titles(answer)).toEqual(['A', 'B', 'C']);
  });

  it('waits for a task of another project', async () => {
    const h = await start();
    const other = await lib(h);
    h.script({ code: [{ waitFor: h.gate('b') }, {}] });
    writeScope(h, '{ scope: global }');
    const b = await addIn(h, other, 'B');
    await addIn(h, h.repo, 'A', { after: [b.item] });
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    const running = await waitGlobal(h, (view) => view.runs.length === 1);
    expect(running.runs[0]?.repository).toBe(other);
    expect(titles(running)).toEqual(['A']);
    expect(running.items[0]?.readiness).toBe('waiting');
    h.open('b');
    await waitGlobal(h, (view) => view.items.length === 0 && view.runs.length === 0);
    expect((await allRuns(h)).map((run) => run.repository)).toEqual([other, h.repo]);
  });

  it('starts from a task added to a stopped queue', async () => {
    const h = await start();
    writeScope(h, '{ scope: global }');
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
    })) as { queue: AnyQueue };
    expect(queued.queue.scope).toBe('global');
    await waitGlobal(h, (view) => view.items.length === 0 && view.runs.length === 0);
    expect(await allRuns(h)).toHaveLength(1);
    await stop(h);
  });
});
