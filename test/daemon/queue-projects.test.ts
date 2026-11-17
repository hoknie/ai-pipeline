import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type StreamEvent,
  type TagView,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { CODE_ONLY_CONFIG, settle, until, type Harness } from './harness.ts';
import {
  POOLS_CONFIG,
  SPLIT_QUEUE,
  addProject,
  direct,
  rowsOf,
  setQueueMax,
  statusesIn,
  waitRow,
  workingIn,
  writeQueue,
} from './pools-harness.ts';
import { itemById, start, stop } from './queue-harness.ts';

interface Added {
  repository: string;
  project: string;
  item: string;
  number: number;
}

/** A project of the daemon next to the harness repository (`repo`). */
async function project(h: Harness, name: string, config = CODE_ONLY_CONFIG): Promise<string> {
  const path = join(dirname(h.repo), name);
  copyTemplateRepo(path, config, { 'lib.ts': 'export const value = 1;\n' });
  await h.call('repository_add', { path });
  return path;
}

const queueIn = async (h: Harness, repository: string): Promise<QueueView> =>
  (await h.call('queue', { repository })) as QueueView;

const tagsIn = async (h: Harness, repository: string): Promise<TagView[]> =>
  (await h.call('tags', { repository })) as TagView[];

const addProjects = async (h: Harness, params: Record<string, unknown>): Promise<Added[]> =>
  (await h.call('queue_add_projects', {
    pipeline: 'feature',
    task: 'Email field in the profile',
    ...params,
  } as never)) as Added[];

/** Two projects, `lib` and `web`, both with the `feature` pipeline. */
async function twoProjects(config = CODE_ONLY_CONFIG) {
  const h = await start(config);
  const lib = await project(h, 'lib', config);
  const web = await project(h, 'web', config);
  return { h, lib, web };
}

describe('a task in several projects', () => {
  it('adds one item per project with the same text', async () => {
    const { h, lib, web } = await twoProjects();
    const added = await addProjects(h, { repositories: ['lib', 'web'] });
    expect(added.map((entry) => entry.repository)).toEqual([lib, web]);
    expect(added.map((entry) => entry.project)).toEqual(['lib', 'web']);
    expect(added.map((entry) => entry.number)).toEqual([1, 1]);
    for (const [path, entry] of [
      [lib, added[0]!],
      [web, added[1]!],
    ] as const) {
      const queue = await queueIn(h, path);
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({
        id: entry.item,
        pipeline: 'feature',
        task: 'Email field in the profile',
        tags: [],
        after: [],
      });
    }
  });

  it('puts the items at the end of the queues', async () => {
    const { h, lib } = await twoProjects();
    for (const title of ['A', 'B']) {
      await h.call('queue_add', { repository: lib, pipeline: 'feature', task: 'x', title });
    }
    const [first] = await addProjects(h, { repositories: ['lib', 'web'] });
    const queue = await queueIn(h, lib);
    expect(queue.items.map((item) => item.id).at(2)).toBe(first!.item);
    expect(itemById(queue, first!.item)?.number).toBe(3);
  });

  it('refuses a pipeline that one project lacks and changes nothing', async () => {
    const { h, lib, web } = await twoProjects();
    const api = await project(h, 'api', CODE_ONLY_CONFIG.replace('feature:', 'fix:'));
    await expect(
      addProjects(h, { repositories: ['lib', 'api', 'web'], tag: 'email' }),
    ).rejects.toThrow('unknown pipeline `feature` in project `api`');
    for (const path of [lib, web, api]) {
      expect((await queueIn(h, path)).items).toEqual([]);
      expect(await tagsIn(h, path)).toEqual([]);
    }
  });

  it('refuses a disabled project and changes nothing', async () => {
    const { h, lib, web } = await twoProjects();
    await h.call('repository_update', { path: web, enabled: false });
    await expect(addProjects(h, { repositories: ['lib', 'web'] })).rejects.toThrow(
      'project `web` is disabled',
    );
    expect((await queueIn(h, lib)).items).toEqual([]);
  });

  it('refuses an unknown project, a repeated project and a stray note', async () => {
    const { h, lib } = await twoProjects();
    await expect(addProjects(h, { repositories: ['lib', 'nope'] })).rejects.toThrow(
      'unknown project `nope`',
    );
    await expect(addProjects(h, { repositories: ['lib', lib] })).rejects.toThrow(
      'project `lib` is listed twice',
    );
    await project(h, 'api');
    await expect(
      addProjects(h, { repositories: ['lib', 'web'], notes: { api: 'x' } }),
    ).rejects.toThrow('not in repositories');
    expect((await queueIn(h, lib)).items).toEqual([]);
  });

  it('refuses an unknown variant of one project and a dependency that does not exist', async () => {
    const { h, lib } = await twoProjects();
    await expect(addProjects(h, { repositories: ['lib', 'web'], variant: 'nope' })).rejects.toThrow(
      'project `lib`',
    );
    await expect(addProjects(h, { repositories: ['lib', 'web'], after: ['nope'] })).rejects.toThrow(
      'unknown dependency `nope`',
    );
    expect((await queueIn(h, lib)).items).toEqual([]);
  });

  it('adds a note to the text of one project only', async () => {
    const { h, lib, web } = await twoProjects();
    const added = await addProjects(h, {
      repositories: ['lib', 'web'],
      task: 'Email field',
      notes: { web: 'Form in Settings.tsx', lib: '  ' },
    });
    expect(itemById(await queueIn(h, lib), added[0]!.item)?.task).toBe('Email field');
    expect(itemById(await queueIn(h, web), added[1]!.item)?.task).toBe(
      'Email field\n\nForm in Settings.tsx',
    );
  });

  it('accepts a note by path', async () => {
    const { h, web } = await twoProjects();
    const added = await addProjects(h, {
      repositories: ['lib', 'web'],
      task: 'Field',
      notes: { [web]: 'Addendum' },
    });
    expect(itemById(await queueIn(h, web), added[1]!.item)?.task).toBe('Field\n\nAddendum');
  });

  it('makes the item of each project wait for the one of the previous project in a chain', async () => {
    const { h, lib, web } = await twoProjects();
    const own = await h.call('queue_add', { repository: lib, pipeline: 'feature', task: 'x' });
    const added = await addProjects(h, {
      repositories: ['lib', 'web'],
      chain: true,
      after: [(own as { item: string }).item],
    });
    const first = itemById(await queueIn(h, lib), added[0]!.item);
    const second = itemById(await queueIn(h, web), added[1]!.item);
    expect(first?.after.map((dependency) => dependency.id)).toEqual([
      (own as { item: string }).item,
    ]);
    expect(second?.after.map((dependency) => dependency.id).sort()).toEqual(
      [(own as { item: string }).item, added[0]!.item].sort(),
    );
    expect(second?.after.every((dependency) => dependency.repository === lib)).toBe(true);
  });

  it('keeps the items independent without a chain', async () => {
    const { h, web } = await twoProjects();
    const added = await addProjects(h, { repositories: ['lib', 'web'] });
    expect(itemById(await queueIn(h, web), added[1]!.item)?.after).toEqual([]);
  });

  it('chains three projects one after another', async () => {
    const { h, lib, web } = await twoProjects();
    const api = await project(h, 'api');
    const added = await addProjects(h, { repositories: ['api', 'lib', 'web'], chain: true });
    const ids = async (path: string, item: string) =>
      itemById(await queueIn(h, path), item)?.after.map((dependency) => dependency.id);
    expect(await ids(api, added[0]!.item)).toEqual([]);
    expect(await ids(lib, added[1]!.item)).toEqual([added[0]!.item]);
    expect(await ids(web, added[2]!.item)).toEqual([added[1]!.item]);
  });

  it('refuses a bad tag name before anything is written', async () => {
    const { h, lib, web } = await twoProjects();
    await expect(
      addProjects(h, { repositories: ['lib', 'web'], tag: 'x'.repeat(31) }),
    ).rejects.toThrow('at most 30 characters');
    expect((await queueIn(h, lib)).items).toEqual([]);
    expect((await queueIn(h, web)).items).toEqual([]);
  });
});

describe('the shared tag of a task in several projects', () => {
  it('creates the tag in both catalogs with one color', async () => {
    const { h, lib, web } = await twoProjects();
    const added = await addProjects(h, { repositories: ['lib', 'web'], tag: 'email' });
    const libTags = await tagsIn(h, lib);
    const webTags = await tagsIn(h, web);
    expect(libTags.map((tag) => tag.name)).toEqual(['email']);
    expect(webTags.map((tag) => tag.name)).toEqual(['email']);
    expect(libTags[0]!.color).toBe(webTags[0]!.color);
    expect(itemById(await queueIn(h, lib), added[0]!.item)?.tags.map((tag) => tag.id)).toEqual([
      libTags[0]!.id,
    ]);
    expect(itemById(await queueIn(h, web), added[1]!.item)?.tags.map((tag) => tag.id)).toEqual([
      webTags[0]!.id,
    ]);
  });

  it('reuses an existing tag by name and gives its color to the new one', async () => {
    const { h, lib, web } = await twoProjects();
    await h.call('tag_add', { repository: web, name: 'Email', color: 'teal' });
    const added = await addProjects(h, { repositories: ['lib', 'web'], tag: 'email' });
    const libTags = await tagsIn(h, lib);
    const webTags = await tagsIn(h, web);
    expect(libTags).toMatchObject([{ name: 'email', color: 'teal' }]);
    expect(webTags).toHaveLength(1);
    expect(itemById(await queueIn(h, web), added[1]!.item)?.tags.map((tag) => tag.name)).toEqual([
      'Email',
    ]);
  });

  it('takes the default color of the first project and tells about both catalogs', async () => {
    const { h, lib, web } = await twoProjects();
    await h.call('tag_add', { repository: lib, name: 'one' });
    await h.call('tag_add', { repository: lib, name: 'two' });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    events.length = 0;
    await addProjects(h, { repositories: ['lib', 'web'], tag: 'email' });
    await until(
      'both catalogs',
      () => events.filter((event) => event.event === 'tags').length >= 2,
    );
    const told = events.flatMap((event) => (event.event === 'tags' ? [event.repository] : []));
    expect(told).toEqual(expect.arrayContaining([lib, web]));
    expect((await tagsIn(h, lib)).find((tag) => tag.name === 'email')?.color).toBe('orange');
    expect((await tagsIn(h, web)).find((tag) => tag.name === 'email')?.color).toBe('orange');
    await stop(h);
    expect(await ended).toBe('closed');
  });

  it('sets no tag without a name or with an empty one', async () => {
    const { h, lib, web } = await twoProjects();
    await addProjects(h, { repositories: ['lib', 'web'] });
    await addProjects(h, { repositories: ['lib', 'web'], tag: '  ' });
    expect(await tagsIn(h, lib)).toEqual([]);
    expect(await tagsIn(h, web)).toEqual([]);
  });

  it('refuses a name that belongs to the tag of a linked task and changes nothing', async () => {
    const { h, lib, web } = await twoProjects();
    const parent = (await h.call('queue_add', {
      repository: web,
      pipeline: 'feature',
      task: 'parent',
      title: 'email',
    })) as { item: string };
    const created = (await h.call('queue_run_now', { repository: web, item: parent.item })) as {
      runId: string;
    };
    await h.waitFor(created.runId, (run) => run.finished);
    await h.call('queue_add', {
      repository: web,
      pipeline: 'feature',
      task: 'child',
      parent: created.runId,
    });
    const number = (await h.status(created.runId)).number;
    await expect(addProjects(h, { repositories: ['lib', 'web'], tag: 'email' })).rejects.toThrow(
      `tag \`email\` belongs to task #${number} and is set automatically in project \`web\``,
    );
    expect(await tagsIn(h, lib)).toEqual([]);
    expect((await queueIn(h, lib)).items).toEqual([]);
  });
});

describe('the limit of the machine and the pools in the project mode', () => {
  /** The fake agents of every group wait for the gate `go` until the test opens it. */
  function hold(h: Harness, gate = 'go'): void {
    h.script({ code: [{ waitFor: h.gate(gate) }] });
  }

  const rowsOfRuns = async (h: Harness, ids: string[]) =>
    (await Promise.all(ids.map((id) => rowsOf(h, id)))).flat();

  it('runs five attempts split 2/2/1 over direct runs, holds the rest and frees the places', async () => {
    const h = await start(POOLS_CONFIG);
    writeQueue(h, SPLIT_QUEUE);
    hold(h);
    const [lib, web, api] = [
      await addProject(h, 'lib'),
      await addProject(h, 'web'),
      await addProject(h, 'api'),
    ];
    const claude = await direct(h, 'on-claude', ['c1', 'c2', 'c3']);
    const gemini = await direct(h, 'on-gemini', ['g1'], lib);
    const gpt = await direct(h, 'on-gpt', ['p1', 'p2'], web);
    const glm = await direct(h, 'on-glm', ['z1', 'z2'], api);
    await waitRow(h, claude, 'c2', 'running');
    await waitRow(h, gpt, 'p1', 'running');
    await waitRow(h, glm, 'z1', 'running');
    await waitRow(h, claude, 'c3', 'waiting');
    await waitRow(h, gpt, 'p2', 'waiting');
    await waitRow(h, glm, 'z2', 'waiting');
    expect(await workingIn(h, [claude, gemini, gpt, glm])).toBe(5);
    expect((await rowsOf(h, claude)).find((row) => row.slug === 'c3')?.wait).toEqual({
      reason: 'pool',
      pool: 'claude',
      max: 2,
    });
    expect((await rowsOf(h, gpt)).find((row) => row.slug === 'p2')?.wait).toEqual({
      reason: 'pool',
      pool: 'mix',
      max: 2,
    });
    expect((await rowsOf(h, glm)).find((row) => row.slug === 'z2')?.wait).toEqual({
      reason: 'pool',
      pool: 'glm',
      max: 1,
    });
    // The attempts keep the runtime and the model of their pools.
    const attempt = (await h.group(gpt, 'p1')).attempts[0]!;
    expect([attempt.runtime, attempt.model]).toEqual(['opencode', 'openai/gpt-5']);
    h.open('go');
    for (const id of [claude, gemini, gpt, glm]) {
      expect((await h.waitFor(id, (view) => view.finished)).state).toBe('finished');
    }
  });

  it('holds an attempt of a project for the machine, then for its repository, in this order', async () => {
    const h = await start(POOLS_CONFIG);
    const narrow = await addProject(h, 'narrow', POOLS_CONFIG.replace('max: 5', 'max: 2'));
    writeQueue(h, '{ max: 3 }');
    h.script({
      'code@a1': [{ waitFor: h.gate('a') }],
      code: [{ waitFor: h.gate('b') }],
    });
    const first = await direct(h, 'on-claude', ['a1']);
    const second = await direct(h, 'on-claude', ['b1', 'b2', 'b3'], narrow);
    await waitRow(h, second, 'b2', 'running');
    const both = await waitRow(h, second, 'b3', 'waiting');
    // Machine: 3 of 3 busy; the repository of `narrow` is full too, and the machine is named first.
    expect(both.wait).toEqual({ reason: 'capacity', scope: 'machine', max: 3 });
    h.open('a');
    await h.waitFor(first, (view) => view.finished);
    await until('the wait names swarm.max', async () => {
      const row = (await rowsOf(h, second)).find((entry) => entry.slug === 'b3');
      return row?.wait?.reason === 'capacity' && row.wait.scope === 'repository';
    });
    const repository = (await rowsOf(h, second)).find((row) => row.slug === 'b3')!;
    expect(repository.wait).toEqual({ reason: 'capacity', scope: 'repository', max: 2 });
    expect(repository.status).toBe('waiting');
    h.open('b');
    expect((await h.waitFor(second, (view) => view.finished)).state).toBe('finished');
  });

  it('names only the machine while the repository has room, and only the repository while the machine has', async () => {
    const h = await start(POOLS_CONFIG);
    const narrow = await addProject(h, 'narrow', POOLS_CONFIG.replace('max: 5', 'max: 1'));
    writeQueue(h, '{ max: 2 }');
    hold(h);
    const wide = await direct(h, 'on-claude', ['w1', 'w2', 'w3']);
    await waitRow(h, wide, 'w2', 'running');
    const machine = await waitRow(h, wide, 'w3', 'waiting');
    expect(machine.wait).toEqual({ reason: 'capacity', scope: 'machine', max: 2 });
    h.open('go');
    await h.waitFor(wide, (view) => view.finished);
    // The machine has room for two, the repository of `narrow` for one.
    hold(h, 'later');
    const tight = await direct(h, 'on-claude', ['n1', 'n2'], narrow);
    await waitRow(h, tight, 'n1', 'running');
    const repository = await waitRow(h, tight, 'n2', 'waiting');
    expect(repository.wait).toEqual({ reason: 'capacity', scope: 'repository', max: 1 });
    h.open('later');
    await h.waitFor(tight, (view) => view.finished);
  });

  it('holds a group for swarm.max in the project mode while queue.max has room', async () => {
    const h = await start(POOLS_CONFIG.replace('max: 5', 'max: 1'));
    writeQueue(h, '{ max: 5 }');
    hold(h);
    const run = await direct(h, 'on-claude', ['r1', 'r2']);
    await waitRow(h, run, 'r1', 'running');
    expect((await waitRow(h, run, 'r2', 'waiting')).wait).toMatchObject({
      reason: 'capacity',
      scope: 'repository',
      max: 1,
    });
    h.open('go');
    expect((await h.waitFor(run, (view) => view.finished)).state).toBe('finished');
  });

  it('holds the repair of a failed group until swarm.max has a free place', async () => {
    const h = await start(POOLS_CONFIG.replace('max: 5', 'max: 2'));
    writeQueue(h, '{ max: 5 }');
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    h.script({
      'code@entry': [{ waitFor: h.gate('fail'), exitCode: 1, noReport: true }, {}],
      code: [{ waitFor: h.gate('go') }],
      repair: [{ toolCalls: [{ name: 'swarm_repair_retry', arguments: { group: 'entry' } }] }],
    });
    const failing = await direct(h, 'on-claude', ['entry']);
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    const other = await direct(h, 'on-claude', ['b1', 'b2']);
    await waitRow(h, failing, 'entry', 'running');
    await waitRow(h, other, 'b1', 'running');
    await waitRow(h, other, 'b2', 'waiting');
    h.open('fail');
    // The place of the failed group goes to the waiting group; the repair finds swarm.max full.
    await waitRow(h, other, 'b2', 'running');
    const held = await h.waitFor(failing, (view) =>
      view.system.some((group) => group.kind === 'repair' && group.status === 'waiting'),
    );
    expect(held.system.find((group) => group.kind === 'repair')?.wait).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 2,
    });
    h.open('go');
    const done = await h.waitFor(failing, (view) => view.finished && view.state === 'finished');
    expect(done.repair?.repairs).toBe(1);
  });

  it('keeps the working attempts when the limit drops and starts the waiting one when it grows', async () => {
    const h = await start(POOLS_CONFIG);
    writeQueue(h, '{ max: 2 }');
    hold(h);
    const run = await direct(h, 'on-claude', ['d1', 'd2', 'd3']);
    await waitRow(h, run, 'd2', 'running');
    await waitRow(h, run, 'd3', 'waiting');
    // Lowering through the settings API: nothing is interrupted, the wait shows the new number.
    await setQueueMax(h, 1);
    await until('the wait shows queue.max 1', async () => {
      const row = (await rowsOf(h, run)).find((entry) => entry.slug === 'd3');
      return row?.wait?.reason === 'capacity' && row.wait.max === 1;
    });
    expect(statusesIn(await rowsOf(h, run))).toEqual(['running', 'running', 'waiting']);
    // Raising it frees a place with no event of any run.
    await setQueueMax(h, 3);
    await waitRow(h, run, 'd3', 'running');
    h.open('go');
    expect((await h.waitFor(run, (view) => view.finished)).state).toBe('finished');
  });

  it('applies a hand edit of settings.yaml only at the next event of the scheduler', async () => {
    const h = await start(POOLS_CONFIG);
    writeQueue(h, '{ max: 2 }');
    hold(h);
    const events: unknown[] = [];
    const ended = subscribe(h.socket, (line) => events.push(line));
    const run = await direct(h, 'on-claude', ['e1', 'e2', 'e3']);
    await waitRow(h, run, 'e2', 'running');
    await waitRow(h, run, 'e3', 'waiting');
    // The agents report their start and the diffs arrive later: wait until the daemon is quiet.
    for (let quiet = 0; quiet < 3;) {
      const seen = events.length;
      await settle(h);
      quiet = seen === events.length ? quiet + 1 : 0;
    }
    writeQueue(h, '{ max: 3 }');
    await settle(h);
    expect((await waitRow(h, run, 'e3', 'waiting')).wait).toMatchObject({
      scope: 'machine',
      max: 2,
    });
    // Another run starts: that is an event of the scheduler, and it reads the new limit.
    const next = await direct(h, 'on-claude', ['f1'], await addProject(h, 'other'));
    await waitRow(h, run, 'e3', 'running');
    expect((await waitRow(h, next, 'f1', 'waiting')).wait).toMatchObject({
      scope: 'machine',
      max: 3,
    });
    h.open('go');
    for (const id of [run, next]) await h.waitFor(id, (view) => view.finished);
    await stop(h);
    await ended;
  });

  it('takes the places of a pool again after a restart: no attempt of the old daemon holds one', async () => {
    const h = await start(POOLS_CONFIG);
    writeQueue(
      h,
      '{ max: 5, pools: { glm: { max: 1, members: ["opencode:zai/*"] } }, default_pool: { max: 3 } }',
    );
    h.script({ code: [{ hang: true }] });
    const old = await direct(h, 'on-glm', ['g1']);
    await waitRow(h, old, 'g1', 'running');
    h.script({ code: [{ waitFor: h.gate('after') }] });
    await h.restart();
    const interrupted = await h.waitFor(old, (view) => view.groups[0]?.status === 'failed');
    expect(interrupted.groups[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
    // The history of the attempt keeps its runtime and model.
    const history = (await h.group(old, 'g1')).attempts[0]!;
    expect([history.runtime, history.model, history.status]).toEqual([
      'opencode',
      'zai/glm-5',
      'failed',
    ]);
    // The only place of the pool is free: a new attempt takes it, the second one waits for it.
    const fresh = await direct(h, 'on-glm', ['n1', 'n2']);
    await waitRow(h, fresh, 'n1', 'running');
    expect((await waitRow(h, fresh, 'n2', 'waiting')).wait).toEqual({
      reason: 'pool',
      pool: 'glm',
      max: 1,
    });
    h.open('after');
    await h.waitFor(fresh, (view) => view.finished);
  });

  it('counts a group without an explicit OpenCode model in the default pool', async () => {
    const h = await start(POOLS_CONFIG);
    writeQueue(h, SPLIT_QUEUE);
    hold(h);
    const run = await direct(h, 'on-plain', ['m1', 'm2']);
    await waitRow(h, run, 'm1', 'running');
    expect((await waitRow(h, run, 'm2', 'waiting')).wait).toEqual({
      reason: 'pool',
      pool: 'default',
      max: 1,
    });
    expect(await rowsOfRuns(h, [run])).toHaveLength(2);
    h.open('go');
    await h.waitFor(run, (view) => view.finished);
  });
});

describe('the provider of a task in several projects', () => {
  const TIERS = (providers: string[]) => `swarm:
  max: 3
  chains:
    coding:
      name: Coding
      mode: by_provider
      runtimes:
${providers
  .map((id) => `        - { provider: ${id}, runtime: opencode, model: ${id}/model }`)
  .join('\n')}
  specialists:
    coder: { name: Coder, runtime_chain: coding }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;

  it('adds the task when every project knows the provider', async () => {
    const h = await start(TIERS(['zai']));
    await project(h, 'lib', TIERS(['zai', 'openai']));
    await project(h, 'web', TIERS(['zai']));
    const added = await addProjects(h, { repositories: ['lib', 'web'], provider: 'zai' });
    expect(added).toHaveLength(2);
    for (const entry of added) {
      expect((await queueIn(h, entry.repository)).items[0]).toMatchObject({ provider: 'zai' });
    }
  });

  it('refuses the whole task naming the first project that lacks the provider', async () => {
    const h = await start(TIERS(['zai']));
    const lib = await project(h, 'lib', TIERS(['zai']));
    const web = await project(h, 'web', TIERS(['openai']));
    await expect(addProjects(h, { repositories: ['lib', 'web'], provider: 'zai' })).rejects.toThrow(
      'unknown provider `zai`; known: openai in project `web`',
    );
    expect((await queueIn(h, lib)).items).toEqual([]);
    expect((await queueIn(h, web)).items).toEqual([]);
  });
});
