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
import { CODE_ONLY_CONFIG, until, type Harness } from './harness.ts';
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
    task: 'Поле email в профиле',
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
        task: 'Поле email в профиле',
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
      task: 'Поле email',
      notes: { web: 'Форма в Settings.tsx', lib: '  ' },
    });
    expect(itemById(await queueIn(h, lib), added[0]!.item)?.task).toBe('Поле email');
    expect(itemById(await queueIn(h, web), added[1]!.item)?.task).toBe(
      'Поле email\n\nФорма в Settings.tsx',
    );
  });

  it('accepts a note by path', async () => {
    const { h, web } = await twoProjects();
    const added = await addProjects(h, {
      repositories: ['lib', 'web'],
      task: 'Поле',
      notes: { [web]: 'Дополнение' },
    });
    expect(itemById(await queueIn(h, web), added[1]!.item)?.task).toBe('Поле\n\nДополнение');
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
