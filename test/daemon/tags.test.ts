import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type QueueView,
  type RunQueued,
  type RunView,
  type StreamEvent,
  type TagView,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';

import {
  CODE_ONLY_CONFIG,
  POLL_MS,
  PIPELINE_CONFIG,
  harness,
  startRun,
  until,
  type Harness,
} from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

// one step in `feature`: the tests count tasks and runs, not the steps
const SCOUT_CONFIG = `${CODE_ONLY_CONFIG.replace(
  '  pipelines:\n',
  '    scout: { name: Разведчик, queue: true }\n  pipelines:\n    explore:\n      steps:\n        - { id: explore, specialist: scout }\n',
)}`;

async function start(config = PIPELINE_CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

const tagsOf = async (h: Harness): Promise<TagView[]> =>
  (await h.call('tags', { repository: h.repo })) as TagView[];
const queueOf = async (h: Harness): Promise<QueueView> =>
  (await h.call('queue', { repository: h.repo })) as QueueView;
const names = (tags: { name: string }[]) => tags.map((tag) => tag.name);

async function addTag(h: Harness, name: string, color?: string): Promise<TagView[]> {
  return (await h.call('tag_add', {
    repository: h.repo,
    name,
    ...(color ? { color } : {}),
  })) as TagView[];
}

async function tagsWhen(h: Harness, done: (tags: TagView[]) => boolean): Promise<TagView[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const tags = await tagsOf(h);
    if (done(tags)) return tags;
    if (Date.now() > deadline) throw new Error('timed out waiting for tags');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function waitQueue(h: Harness, done: (queue: QueueView) => boolean): Promise<QueueView> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const queue = await queueOf(h);
    if (done(queue)) return queue;
    if (Date.now() > deadline) throw new Error(`timed out; queue: ${JSON.stringify(queue)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const allRuns = async (h: Harness): Promise<RunView[]> =>
  ((await h.call('status', {})) as RunView[]).sort((a, b) => a.createdAt - b.createdAt);

/** A second git repository next to the harness one, with the same config. */
async function secondRepo(h: Harness): Promise<string> {
  const other = join(h.repo, '..', 'lib');
  mkdirSync(other, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', other]);
  writeFileSync(join(other, 'x'), '1');
  execFileSync('git', ['-C', other, 'add', '-A']);
  execFileSync('git', [
    '-C',
    other,
    '-c',
    'user.name=T',
    '-c',
    'user.email=t@e.x',
    'commit',
    '-q',
    '-m',
    'i',
  ]);
  const { writeConfigDirectory } = await import('../fixtures/config.ts');
  writeConfigDirectory(other, PIPELINE_CONFIG);
  return other;
}

/** A finished run of `feature` in `repository`. */
async function finishedRun(h: Harness, repository: string, title: string): Promise<RunView> {
  const added = (await h.call('queue_add', {
    repository,
    pipeline: 'feature',
    task: 'p',
    title,
  })) as QueueView & { item: string };
  const created = (await h.call('queue_run_now', { repository, item: added.item })) as {
    runId: string;
  };
  await h.waitFor(created.runId, (run) => run.finished);
  return h.status(created.runId);
}

describe('tag catalog', () => {
  // The tests that only add and read tags share one daemon (the catalog is emptied after each
  // test); the one that restarts the daemon starts its own.
  let shared: Harness;
  beforeAll(async () => {
    shared = await harness(PIPELINE_CONFIG);
  });
  afterAll(async () => {
    await shared.close();
  });
  afterEach(async () => {
    for (const tag of await tagsOf(shared))
      await shared.call('tag_remove', { repository: shared.repo, tag: tag.name });
  });

  it('is empty at first', async () => {
    const h = shared;
    expect(await tagsOf(h)).toEqual([]);
  });

  it('is sorted by name ignoring case and survives a restart with the same id and color', async () => {
    const h = await start();
    await addTag(h, 'beta');
    const added = await addTag(h, 'Auth', 'blue');
    expect(names(added)).toEqual(['Auth', 'beta']);
    const before = await tagsOf(h);
    await h.restart();
    expect(await tagsOf(h)).toEqual(before);
    expect(before.find((tag) => tag.name === 'Auth')).toMatchObject({ color: 'blue' });
  });

  it('rejects a name that is too long, a repeat in another case and an unknown color', async () => {
    const h = shared;
    await addTag(h, 'auth');
    await expect(addTag(h, 'x'.repeat(31))).rejects.toThrow();
    await expect(addTag(h, ' AUTH ')).rejects.toThrow('tag `auth` already exists');
    await expect(addTag(h, 'other', '#ff0000')).rejects.toThrow('known: gray, red');
    expect(names(await tagsOf(h))).toEqual(['auth']);
  });

  it('gives the third tag the third color of the palette', async () => {
    const h = shared;
    await addTag(h, 'a');
    await addTag(h, 'b');
    const tags = await addTag(h, 'c');
    expect(tags.find((tag) => tag.name === 'c')?.color).toBe('orange');
  });

  it('renames a tag under the same id and changes the case of a name', async () => {
    const h = shared;
    const [created] = await addTag(h, 'auth', 'blue');
    const renamed = (await h.call('tag_edit', {
      repository: h.repo,
      tag: 'auth',
      name: 'login',
    })) as TagView[];
    expect(renamed).toEqual([{ ...created, name: 'login' }]);
    const recased = (await h.call('tag_edit', {
      repository: h.repo,
      tag: 'LOGIN',
      name: 'Login',
    })) as TagView[];
    expect(recased[0]?.name).toBe('Login');
  });

  it('shows a renamed tag on tasks and runs', async () => {
    const h = await start();
    await addTag(h, 'auth', 'blue');
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth'],
    })) as RunQueued;
    await h.call('tag_edit', { repository: h.repo, tag: 'auth', name: 'login', color: 'teal' });
    const view = await h.status(queued.run!.runId);
    expect(view.tags).toMatchObject([{ name: 'login', color: 'teal' }]);
    await h.waitFor(view.id, (run) => run.finished);
  });

  it('keeps a separate catalog for every repository', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const other = await secondRepo(h);
    // a tag of another repository is unknown here
    expect(await h.call('tags', { repository: other })).toEqual([]);
    await expect(
      h.call('queue_add', { repository: other, pipeline: 'feature', task: 'b', tags: ['auth'] }),
    ).rejects.toThrow('unknown tag `auth`');
    // the same name in both repositories gives two tags
    const added = (await h.call('tag_add', {
      repository: other,
      name: 'AUTH',
      color: 'pink',
    })) as TagView[];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: 'AUTH', color: 'pink', repository: other });
    const mine = (await tagsOf(h))[0]!;
    expect(mine.repository).toBe(h.repo);
    expect(mine.id).not.toBe(added[0]!.id);
    const first = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'a',
      tags: ['auth'],
    })) as QueueView;
    const second = (await h.call('queue_add', {
      repository: other,
      pipeline: 'feature',
      task: 'b',
      tags: ['auth'],
    })) as QueueView;
    expect(first.items[0]?.tags[0]?.id).toBe(mine.id);
    expect(second.items[0]?.tags[0]?.id).toBe(added[0]!.id);
    // removing the tag in one repository leaves the other one alone
    await h.call('tag_remove', { repository: h.repo, tag: 'auth' });
    expect(await tagsOf(h)).toEqual([]);
    const kept = (await h.call('tags', { repository: other })) as TagView[];
    expect(kept.map((tag) => tag.id)).toEqual([added[0]!.id]);
    const queue = (await h.call('queue', { repository: other })) as QueueView;
    expect(queue.items[0]?.tags.map((tag) => tag.id)).toEqual([added[0]!.id]);
  });

  it('puts all tags and the repository into the tags event', async () => {
    const h = await start();
    const events: StreamEvent[] = [];
    void subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await until('the snapshot', () => events.length > 0);
    await addTag(h, 'auth');
    await until('a tags event', () => events.some((event) => event.event === 'tags'));
    const event = events.find((candidate) => candidate.event === 'tags');
    expect(event).toMatchObject({ event: 'tags', repository: h.repo });
  });
});

describe('tag removal', () => {
  it('takes the tag off a waiting task and a finished run and does not bring it back', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const finished = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    });
    await h.waitFor(finished.runId, (run) => run.finished);
    await waitQueue(h, (queue) => queue.status === 'stopped');
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
      tags: ['auth', 'v2'],
    });
    const left = (await h.call('tag_remove', { repository: h.repo, tag: 'AUTH' })) as TagView[];
    expect(names(left)).toEqual(['v2']);
    expect(names((await h.status(finished.runId)).tags)).toEqual(['v2']);
    expect(names((await queueOf(h)).items[0]!.tags)).toEqual(['v2']);
    await h.restart();
    expect(names(await tagsOf(h))).toEqual(['v2']);
    expect(names((await h.status(finished.runId)).tags)).toEqual(['v2']);
    expect(names((await queueOf(h)).items[0]!.tags)).toEqual(['v2']);
  });

  it('rejects an unknown tag', async () => {
    const h = await start();
    await expect(h.call('tag_remove', { repository: h.repo, tag: 'nope' })).rejects.toThrow(
      'unknown tag `nope`',
    );
  });
});

describe('tag events', () => {
  it('sends the catalog in the snapshot and a tags event to a subscriber', async () => {
    const h = await start();
    await addTag(h, 'old');
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    const snapshot = events[0];
    expect(
      snapshot?.event === 'snapshot' ? names(snapshot.tags as unknown as TagView[]) : null,
    ).toEqual(['old']);
    await addTag(h, 'auth');
    await h.call('tag_edit', { repository: h.repo, tag: 'auth', color: 'teal' });
    await h.call('tag_remove', { repository: h.repo, tag: 'old' });
    await until('three tags events', () => events.filter((e) => e.event === 'tags').length >= 3);
    const tagEvents = events.filter((event) => event.event === 'tags');
    expect(
      tagEvents.map((event) =>
        event.event === 'tags' ? names(event.tags as unknown as TagView[]) : [],
      ),
    ).toEqual([['auth', 'old'], ['auth', 'old'], ['auth']]);
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('sends a run event when the tags of a run change', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
    });
    await h.waitFor(created.runId, (run) => run.finished);
    const events: StreamEvent[] = [];
    subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await until('the snapshot', () => events.length > 0);
    await h.call('run_tags', { runId: created.runId, add: ['auth'] });
    // the snapshot may carry the run as well, still without the tag: wait for the event of the change
    const tagged = (event: StreamEvent) =>
      event.event === 'run' && (event.run as unknown as RunView).tags.length > 0;
    await until('a run event with the tag', () => events.some(tagged));
    const run = events.find(tagged);
    expect(run?.event === 'run' ? (run.run as unknown as RunView).tags : null).toMatchObject([
      { name: 'auth' },
    ]);
  });
});

describe('tags of tasks', () => {
  it('keeps the tags of an item in order without repeats and replaces them on edit', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
      tags: ['v2', 'AUTH', 'V2'],
    })) as QueueView & { item: string };
    expect(names(added.items[0]!.tags)).toEqual(['v2', 'auth']);
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item: added.item,
      tags: ['v2'],
    })) as QueueView;
    expect(names(edited.items[0]!.tags)).toEqual(['v2']);
    const untouched = (await h.call('queue_edit', {
      repository: h.repo,
      item: added.item,
      task: 'новый текст',
    })) as QueueView;
    expect(names(untouched.items[0]!.tags)).toEqual(['v2']);
    const cleared = (await h.call('queue_edit', {
      repository: h.repo,
      item: added.item,
      tags: [],
    })) as QueueView;
    expect(cleared.items[0]!.tags).toEqual([]);
  });

  it('refuses an unknown tag and leaves the queue as it was', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await expect(
      h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'x',
        tags: ['auth', 'nope'],
      }),
    ).rejects.toThrow('unknown tag `nope`; create it with `aip tag add nope`');
    expect((await queueOf(h)).items).toEqual([]);
    await expect(
      h.call('run', { repository: h.repo, pipeline: 'feature', task: 'x', tags: ['nope'] }),
    ).rejects.toThrow('unknown tag');
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('gives a started run the tags of its item', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    });
    expect(names((await h.status(created.runId)).tags)).toEqual(['auth', 'v2']);
    await h.waitFor(created.runId, (run) => run.finished);
  });

  it('gives a run started now the tags of its item', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: added.item,
    })) as { runId: string };
    expect(names((await h.status(created.runId)).tags)).toEqual(['auth', 'v2']);
    await h.waitFor(created.runId, (run) => run.finished);
  });

  it('does not pass a tag removed before the start', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    })) as QueueView & { item: string };
    await h.call('tag_remove', { repository: h.repo, tag: 'auth' });
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: added.item,
    })) as { runId: string };
    expect(names((await h.status(created.runId)).tags)).toEqual(['v2']);
    await h.waitFor(created.runId, (run) => run.finished);
  });
});

describe('tags of runs', () => {
  it('adds and removes tags of a finished run in any order', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
    });
    const done = await h.waitFor(created.runId, (run) => run.finished);
    expect(done.tags).toEqual([]);
    const added = (await h.call('run_tags', {
      runId: created.runId,
      add: ['auth', 'v2', 'AUTH'],
    })) as RunView;
    expect(names(added.tags)).toEqual(['auth', 'v2']);
    expect(added.state).toBe(done.state);
    expect(added.groups.map((group) => group.status)).toEqual(done.groups.map((g) => g.status));
    const removed = (await h.call('run_tags', {
      runId: created.runId,
      remove: ['v2'],
    })) as RunView;
    expect(names(removed.tags)).toEqual(['auth']);
    await h.restart();
    expect(names((await h.status(created.runId)).tags)).toEqual(['auth']);
  });

  it('refuses an unknown run and an unknown tag without changes', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await expect(h.call('run_tags', { runId: 'nope', add: ['auth'] })).rejects.toThrow(
      'unknown run',
    );
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
    });
    await expect(
      h.call('run_tags', { runId: created.runId, add: ['auth', 'nope'] }),
    ).rejects.toThrow('unknown tag `nope`');
    expect((await h.status(created.runId)).tags).toEqual([]);
    await h.waitFor(created.runId, (run) => run.finished);
  });
});

describe('tags of tasks from a specialist', () => {
  const EXPLORE = {
    repository: '',
    pipeline: 'explore',
    groups: [
      { title: 'один', task: 'a' },
      { title: 'два', task: 'b' },
    ],
  };

  async function exploreNow(
    h: Harness,
    tags: string[] | undefined,
    title?: string,
  ): Promise<string> {
    const added = (await h.call('queue_add', {
      ...EXPLORE,
      repository: h.repo,
      ...(title ? { title } : {}),
      ...(tags ? { tags } : {}),
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: added.item,
    })) as { runId: string };
    return created.runId;
  }

  it('passes the tags of an explore run to its tasks and from them to the started runs', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({
      explore: [{ queue: { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] } }],
    });
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const explore = await exploreNow(h, ['auth', 'v2']);
    await h.waitFor(explore, (run) => run.finished);
    // the queue is stopped, so the tasks wait
    const waiting = await queueOf(h);
    expect(waiting.items).toHaveLength(2);
    // the linked task tag of the explore run comes first, then the tags of the run
    for (const item of waiting.items) expect(names(item.tags)).toEqual([explore, 'auth', 'v2']);
    expect(names(await tagsOf(h))).toEqual(['auth', explore, 'v2'].sort());
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(names(run.tags)).toEqual([explore, 'auth', 'v2']);
    for (const run of runs) await h.waitFor(run.id, (view) => view.finished);
  });

  const ONE = { queue: { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] } };

  it('creates one tag for a run without tags and gives it to the run and both tasks', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    const explore = await exploreNow(h, undefined, 'Fix login');
    await h.waitFor(explore, (run) => run.finished);
    const catalog = await tagsOf(h);
    expect(names(catalog)).toEqual(['fix-login']);
    const waiting = await queueOf(h);
    expect(waiting.items).toHaveLength(2);
    for (const item of waiting.items) expect(names(item.tags)).toEqual(names(catalog));
    expect(names((await h.status(explore)).tags)).toEqual(names(catalog));
  });

  it('sends tags, run and queue events when the tag is created', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    const events: StreamEvent[] = [];
    subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await until('the snapshot', () => events.length > 0);
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    await until('tags, run and queue events', () =>
      ['tags', 'run', 'queue'].every((kind) => events.some((event) => event.event === kind)),
    );
    const kinds = new Set(events.map((event) => event.event));
    for (const kind of ['tags', 'run', 'queue']) expect(kinds.has(kind as never)).toBe(true);
  });

  it('carries the automatic tag along the chain without creating another', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const catalog = await tagsOf(h);
    expect(catalog).toHaveLength(1);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(names(run.tags)).toEqual(names(catalog));
    for (const run of runs) await h.waitFor(run.id, (view) => view.finished);
  });

  it('adds a suffix when the name of the run is taken by an existing tag', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    await addTag(h, 'Fix-Login');
    const added = (await h.call('queue_add', {
      ...EXPLORE,
      repository: h.repo,
      title: 'Fix login',
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: added.item,
    })) as { runId: string };
    await h.waitFor(created.runId, (run) => run.finished);
    expect(names(await tagsOf(h))).toContain('fix-login-2');
    expect(names((await h.status(created.runId)).tags)).toEqual(['fix-login-2']);
    for (const item of (await queueOf(h)).items)
      expect(names(item.tags)).not.toContain('Fix-Login');
    for (const run of await allRuns(h)) expect(names(run.tags)).not.toContain('Fix-Login');
  });

  it('puts the automatic tag before the tags of a predecessor', async () => {
    const h = await start(SCOUT_CONFIG);
    await addTag(h, 'v2');
    const before = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['v2'],
    })) as QueueView & { item: string };
    h.script({
      explore: [{ queue: { ...ONE.queue, after: [before.item] } }],
    });
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    const catalog = await tagsOf(h);
    const auto = catalog.find((tag) => tag.name !== 'v2');
    expect(auto).toBeDefined();
    const queued = (await queueOf(h)).items.find((item) => item.id !== before.item);
    expect(names(queued?.tags ?? [])).toEqual([auto?.name, 'v2']);
  });

  it('does not bring back an automatic tag that was removed', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    const [auto] = await tagsOf(h);
    await h.call('tag_remove', { repository: h.repo, tag: auto?.name ?? '' });
    expect(await tagsOf(h)).toEqual([]);
    for (const item of (await queueOf(h)).items) expect(item.tags).toEqual([]);
    expect((await h.status(explore)).tags).toEqual([]);
  });

  it('creates a new tag when a run calls the queue again after its tag was removed', async () => {
    const config = SCOUT_CONFIG.replace(
      '  pipelines:\n',
      '  pipelines:\n    twice:\n      steps:\n        - { id: first, specialist: scout }\n        - { id: second, specialist: scout }\n',
    );
    const h = await start(config);
    // the second step calls the queue only after the test removed the tag
    h.script({ first: [ONE], second: [{ waitFor: h.gate('second'), ...ONE }] });
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'twice',
      title: 'Fix login',
      groups: [{ title: 'g', task: 'a' }],
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', {
      repository: h.repo,
      item: added.item,
    })) as { runId: string };
    const first = await tagsWhen(h, (tags) => tags.length === 1);
    expect(names(first)).toEqual(['fix-login']);
    await h.call('tag_remove', { repository: h.repo, tag: 'fix-login' });
    h.open('second');
    await h.waitFor(created.runId, (run) => run.finished);
    const catalog = await tagsOf(h);
    expect(names(catalog)).toEqual(['fix-login']);
    expect(catalog[0]?.id).not.toBe(first[0]?.id);
    expect(names((await h.status(created.runId)).tags)).toEqual(['fix-login']);
    const items = (await queueOf(h)).items;
    expect(items).toHaveLength(2);
    expect(names(items.at(-1)?.tags ?? [])).toEqual(['fix-login']);
  });

  it('gives the automatic tag to tasks that already wait for the run', async () => {
    const h = await start(SCOUT_CONFIG);
    // the explore run calls the queue only after the waiting task is added
    h.script({ explore: [{ waitFor: h.gate('explore'), ...ONE }] });
    const explore = await exploreNow(h, undefined);
    const waiter = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'g', task: 'w' }],
      after: [explore],
    })) as QueueView & { item: string };
    h.open('explore');
    await h.waitFor(explore, (run) => run.finished);
    const [auto] = await tagsOf(h);
    expect(auto).toBeDefined();
    const items = (await queueOf(h)).items;
    expect(items).toHaveLength(3);
    expect(names(items.find((item) => item.id === waiter.item)?.tags ?? [])).toEqual([auto?.name]);
  });

  it('creates no tag when the pipeline of the task is unknown', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({
      explore: [{ queue: { pipeline: 'missing', groups: [{ title: 'g', task: 't' }] } }],
    });
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    expect(await tagsOf(h)).toEqual([]);
    expect((await queueOf(h)).items).toHaveLength(0);
    expect((await h.status(explore)).tags).toEqual([]);
  });

  it('gives only the automatic tag to a task when a tag is added to the run later', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    await addTag(h, 'auth');
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    const auto = (await tagsOf(h)).find((tag) => tag.name !== 'auth');
    await h.call('run_tags', { runId: explore, add: ['auth'] });
    for (const item of (await queueOf(h)).items) expect(names(item.tags)).toEqual([auto?.name]);
    expect(names((await h.status(explore)).tags).sort()).toEqual([auto?.name, 'auth'].sort());
  });
});

describe('tags along dependencies', () => {
  const TASK = { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] };

  async function add(h: Harness, extra: Record<string, unknown>): Promise<string> {
    const added = (await h.call('queue_add', {
      ...TASK,
      repository: h.repo,
      ...extra,
    })) as QueueView & { item: string };
    return added.item;
  }

  const tagsOfItem = async (h: Harness, id: string): Promise<string[]> =>
    names((await queueOf(h)).items.find((item) => item.id === id)?.tags ?? []);

  async function twoTags(): Promise<Harness> {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    await addTag(h, 'ui');
    return h;
  }

  it('gives a task the tags of the item it waits for, after its own tags', async () => {
    const h = await twoTags();
    const first = await add(h, { tags: ['auth', 'v2'] });
    const plain = await add(h, { after: [first] });
    const own = await add(h, { after: [first], tags: ['ui'] });
    expect(await tagsOfItem(h, plain)).toEqual(['auth', 'v2']);
    expect(await tagsOfItem(h, own)).toEqual(['ui', 'auth', 'v2']);
  });

  it('gives a task the tags of a run it waits for, also when it was an item before', async () => {
    const h = await twoTags();
    const first = await add(h, { tags: ['auth'] });
    const created = (await h.call('queue_run_now', { repository: h.repo, item: first })) as {
      runId: string;
    };
    await h.call('run_tags', { runId: created.runId, add: ['v2'] });
    const byRun = await add(h, { after: [created.runId] });
    const byItem = await add(h, { after: [first] });
    expect(await tagsOfItem(h, byRun)).toEqual(['auth', 'v2']);
    expect(await tagsOfItem(h, byItem)).toEqual(['auth', 'v2']);
    await h.waitFor(created.runId, (run) => run.finished);
  });

  it('passes inherited tags from a queued task to its run', async () => {
    const h = await twoTags();
    const first = await add(h, { tags: ['auth'] });
    const second = await add(h, { after: [first] });
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(names(run.tags)).toEqual(['auth']);
    expect(second).toBeTruthy();
    for (const run of runs) await h.waitFor(run.id, (view) => view.finished);
  });

  it('adds the tags of new predecessors on edit, keeps a removed tag removed and keeps tags when the link goes', async () => {
    const h = await twoTags();
    const first = await add(h, { tags: ['auth'] });
    const second = await add(h, {});
    await h.call('queue_edit', { repository: h.repo, item: second, after: [first], tags: [] });
    expect(await tagsOfItem(h, second)).toEqual(['auth']);
    await h.call('queue_edit', { repository: h.repo, item: second, tags: [] });
    expect(await tagsOfItem(h, second)).toEqual([]);
    await h.call('queue_edit', { repository: h.repo, item: second, tags: ['auth'] });
    await h.call('queue_edit', { repository: h.repo, item: second, after: [] });
    expect(await tagsOfItem(h, second)).toEqual(['auth']);
  });

  it('spreads a tag added to an item along the chain, but not a removal', async () => {
    const h = await twoTags();
    const first = await add(h, {});
    const second = await add(h, { after: [first] });
    const third = await add(h, { after: [second] });
    const loose = await add(h, {});
    await h.call('queue_edit', { repository: h.repo, item: first, tags: ['auth'] });
    expect(await tagsOfItem(h, second)).toEqual(['auth']);
    expect(await tagsOfItem(h, third)).toEqual(['auth']);
    expect(await tagsOfItem(h, loose)).toEqual([]);
    await h.call('queue_edit', { repository: h.repo, item: first, tags: [] });
    expect(await tagsOfItem(h, second)).toEqual(['auth']);
  });

  it('moves a tag of a run to the waiting task and sends a queue event', async () => {
    const h = await twoTags();
    const first = await add(h, {});
    const created = (await h.call('queue_run_now', { repository: h.repo, item: first })) as {
      runId: string;
    };
    const waiting = await add(h, { after: [created.runId] });
    const loose = await add(h, {});
    const events: StreamEvent[] = [];
    subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await until('the snapshot', () => events.length > 0);
    await h.call('run_tags', { runId: created.runId, add: ['auth'] });
    await until('a queue event', () => events.some((event) => event.event === 'queue'));
    expect(await tagsOfItem(h, waiting)).toEqual(['auth']);
    expect(await tagsOfItem(h, loose)).toEqual([]);
    expect(events.some((event) => event.event === 'queue')).toBe(true);
    await h.waitFor(created.runId, (run) => run.finished);
  });
});

describe('tags of linked tasks', () => {
  const ONE = { queue: { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] } };

  /** An explore run puts two tasks in the queue and gets the tag `fix-login` of a linked task. */
  async function chain(): Promise<{ h: Harness; explore: RunView }> {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [ONE] });
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'explore',
      groups: [
        { title: 'один', task: 'a' },
        { title: 'два', task: 'b' },
      ],
      title: 'Fix login',
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', { repository: h.repo, item: added.item })) as {
      runId: string;
    };
    await h.waitFor(created.runId, (run) => run.finished);
    return { h, explore: await h.status(created.runId) };
  }

  it('makes the automatic tag indigo with the source task, and keeps it after a restart', async () => {
    const { h, explore } = await chain();
    const [tag] = await tagsOf(h);
    expect(tag).toMatchObject({
      name: 'fix-login',
      color: 'indigo',
      task: { run: explore.id, number: explore.number },
    });
    expect((await queueOf(h)).items[0]!.tags[0]!.task).toEqual(tag!.task);
    await h.restart();
    expect((await tagsOf(h))[0]).toEqual(tag);
  });

  it('refuses to assign the tag by hand and changes nothing', async () => {
    const { h, explore } = await chain();
    const message = `tag \`fix-login\` belongs to task #${explore.number} and is set automatically`;
    const before = await queueOf(h);
    await expect(
      h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'x',
        tags: ['fix-login'],
      }),
    ).rejects.toThrow(message);
    await expect(
      h.call('run', { repository: h.repo, pipeline: 'feature', task: 'x', tags: ['fix-login'] }),
    ).rejects.toThrow(message);
    await expect(
      h.call('queue_edit', {
        repository: h.repo,
        item: before.items[0]!.id,
        tags: ['fix-login'],
      }),
    ).rejects.toThrow(message);
    await expect(h.call('run_tags', { runId: explore.id, add: ['fix-login'] })).rejects.toThrow(
      message,
    );
    expect(await queueOf(h)).toEqual(before);
  });

  it('keeps the tag on queue_edit and lets run_tags remove it', async () => {
    const { h, explore } = await chain();
    await addTag(h, 'v2');
    const item = (await queueOf(h)).items[0]!;
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item: item.id,
      tags: ['v2'],
    })) as QueueView;
    expect(names(edited.items[0]!.tags)).toEqual(['fix-login', 'v2']);
    const cleared = (await h.call('queue_edit', {
      repository: h.repo,
      item: item.id,
      tags: [],
    })) as QueueView;
    expect(names(cleared.items[0]!.tags)).toEqual(['fix-login']);
    const run = (await h.call('run_tags', { runId: explore.id, remove: ['fix-login'] })) as RunView;
    expect(run.tags).toEqual([]);
  });

  it('refuses reserved color and a color change of the tag', async () => {
    const { h } = await chain();
    await expect(addTag(h, 'x', 'indigo')).rejects.toThrow('reserved for linked task tags');
    await addTag(h, 'plain');
    await expect(
      h.call('tag_edit', { repository: h.repo, tag: 'plain', color: 'indigo' }),
    ).rejects.toThrow('reserved for linked task tags');
    await expect(
      h.call('tag_edit', { repository: h.repo, tag: 'fix-login', color: 'red' }),
    ).rejects.toThrow('linked task tag color cannot be changed');
    const renamed = (await h.call('tag_edit', {
      repository: h.repo,
      tag: 'fix-login',
      name: 'login',
    })) as TagView[];
    expect(renamed.find((tag) => tag.name === 'login')).toMatchObject({ color: 'indigo' });
  });
});

describe('parent of a task', () => {
  const ONE = { queue: { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] } };

  /** A run of the `feature` pipeline made from the queue; the queue stays stopped. */
  async function parentRun(h: Harness, title: string): Promise<RunView> {
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'parent',
      title,
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', { repository: h.repo, item: added.item })) as {
      runId: string;
    };
    await h.waitFor(created.runId, (run) => run.finished);
    return h.status(created.runId);
  }

  const add = async (h: Harness, extra: Record<string, unknown>): Promise<QueueView> =>
    (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'child',
      ...extra,
    })) as QueueView;

  it('makes the linked task tag of the parent by task number and gives it to the parent first', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const parent = await parentRun(h, 'Cards half width');
    const view = await add(h, { parent: parent.number });
    const [tag] = await tagsOf(h).then((tags) => tags.filter((candidate) => candidate.task));
    expect(tag).toMatchObject({
      name: 'cards-half-width',
      color: 'indigo',
      task: { run: parent.id, number: parent.number },
    });
    expect(view.items[0]!.tags).toEqual([tag]);
    expect(names((await h.status(parent.id)).tags)).toEqual(['cards-half-width']);
  });

  it('takes a number written as #N and a run id, and reuses the existing tag', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    await add(h, { parent: `#${parent.number}` });
    await add(h, { parent: parent.id });
    await add(h, { parent: String(parent.number) });
    const linked = (await tagsOf(h)).filter((tag) => tag.task);
    expect(linked).toHaveLength(1);
    const items = (await queueOf(h)).items;
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.tags).toEqual(linked);
  });

  it('returns a tag taken off the parent to it, first', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const parent = await parentRun(h, 'Fix login');
    await add(h, { parent: parent.id });
    await h.call('run_tags', { runId: parent.id, remove: ['fix-login'] });
    await h.call('run_tags', { runId: parent.id, add: ['auth'] });
    await add(h, { parent: parent.id });
    expect(names((await h.status(parent.id)).tags)).toEqual(['fix-login', 'auth']);
    expect((await tagsOf(h)).filter((tag) => tag.task)).toHaveLength(1);
  });

  it('refuses an unknown run, an unknown number and the number of a waiting task, changing nothing', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    const waiting = await add(h, {});
    const waitingNumber = waiting.items[0]!.number;
    const before = await queueOf(h);
    const catalog = await tagsOf(h);
    for (const value of ['nope', 9999, '#9999', waitingNumber]) {
      await expect(add(h, { parent: value })).rejects.toThrow(`unknown parent \`${value}\``);
      await expect(
        h.call('run', { repository: h.repo, pipeline: 'feature', task: 'x', parent: value }),
      ).rejects.toThrow('unknown parent');
      await expect(
        h.call('queue_edit', {
          repository: h.repo,
          item: before.items[0]!.id,
          title: 'renamed',
          parent: value,
        }),
      ).rejects.toThrow('unknown parent');
    }
    expect(await queueOf(h)).toEqual(before);
    expect(await tagsOf(h)).toEqual(catalog);
    expect((await h.status(parent.id)).tags).toEqual([]);
  });

  it('does not create a tag when the pipeline is unknown', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    await expect(add(h, { pipeline: 'missing', parent: parent.id })).rejects.toThrow();
    expect(await tagsOf(h)).toEqual([]);
    expect((await h.status(parent.id)).tags).toEqual([]);
  });

  it('puts the parent tag before the own tags and the tags of the predecessor', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const parent = await parentRun(h, 'Fix login');
    const first = await add(h, { tags: ['v2'] });
    const itemId = first.items[0]!.id;
    const view = await add(h, { parent: parent.id, tags: ['auth'], after: [itemId] });
    const second = view.items[1]!;
    expect(names(second.tags)).toEqual(['fix-login', 'auth', 'v2']);
    expect(second.after.map((ref) => ref.id)).toEqual([itemId]);
  });

  it('checks the whole request before it creates the tag', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    const first = await add(h, {});
    const item = first.items[0]!.id;
    const before = await queueOf(h);
    const catalog = await tagsOf(h);
    const edit = (extra: Record<string, unknown>) =>
      h.call('queue_edit', { repository: h.repo, item, parent: parent.id, ...extra });
    await expect(edit({ after: [item] })).rejects.toThrow('cannot depend on itself');
    await expect(edit({ position: 99 })).rejects.toThrow('position must be');
    await expect(edit({ task: 'a', groups: [{ title: 'g', task: 't' }] })).rejects.toThrow(
      'pass either task or groups',
    );
    const second = await add(h, { after: [item] });
    const other = second.items[1]!.id;
    await expect(
      h.call('queue_edit', {
        repository: h.repo,
        item,
        parent: parent.id,
        after: [other],
      }),
    ).rejects.toThrow('dependency cycle');
    const both = { task: 'a', groups: [{ title: 'g', task: 't' }] };
    await expect(add(h, { parent: parent.id, ...both })).rejects.toThrow(
      'pass either task or groups',
    );
    await expect(
      h.call('run', { repository: h.repo, pipeline: 'feature', parent: parent.id, ...both }),
    ).rejects.toThrow('pass either task or groups');
    expect((await queueOf(h)).items.map((entry) => entry.tags)).toEqual(
      before.items.map((entry) => entry.tags).concat([[]]),
    );
    expect(await tagsOf(h)).toEqual(catalog);
    expect((await h.status(parent.id)).tags).toEqual([]);
  });

  it('keeps the tags of a new predecessor behind the tag of the new parent on edit', async () => {
    const h = await start();
    const one = await parentRun(h, 'Fix login');
    const two = await parentRun(h, 'Add cards');
    const dep = await add(h, { parent: two.id });
    const depId = dep.items[0]!.id;
    const view = await add(h, {});
    const item = view.items[1]!.id;
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item,
      parent: one.id,
      after: [depId],
    })) as QueueView;
    expect(names(edited.items[1]!.tags)).toEqual(['fix-login', 'add-cards']);
  });

  it('moves the tag to the run started now', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'child',
      parent: parent.id,
    });
    expect(names((await h.status(created.runId)).tags)).toEqual(['fix-login']);
  });

  it('still refuses the name of a linked task tag among tags', async () => {
    const h = await start();
    const parent = await parentRun(h, 'Fix login');
    await add(h, { parent: parent.id });
    await expect(add(h, { tags: ['fix-login'] })).rejects.toThrow(
      `tag \`fix-login\` belongs to task #${parent.number} and is set automatically`,
    );
  });

  it('removes the linked task tag with parent null and changes the parent on edit', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const one = await parentRun(h, 'Fix login');
    const two = await parentRun(h, 'Add cards');
    const view = await add(h, { parent: one.id, tags: ['auth'] });
    const item = view.items[0]!.id;
    const edit = async (params: Record<string, unknown>): Promise<QueueView> =>
      (await h.call('queue_edit', { repository: h.repo, item, ...params })) as QueueView;
    // an edit without parent keeps the linked task tag
    expect(names((await edit({ title: 'x' })).items[0]!.tags)).toEqual(['fix-login', 'auth']);
    expect(names((await edit({ parent: two.number })).items[0]!.tags)).toEqual([
      'add-cards',
      'auth',
    ]);
    expect(names((await edit({ parent: null })).items[0]!.tags)).toEqual(['auth']);
    // the tags stay in the catalog and on the parents
    expect(names((await tagsOf(h)).filter((tag) => tag.task))).toEqual(['add-cards', 'fix-login']);
    expect(names((await h.status(one.id)).tags)).toEqual(['fix-login']);
    // parent together with tags
    const both = await edit({ parent: one.id, tags: [] });
    expect(names(both.items[0]!.tags)).toEqual(['fix-login']);
  });
});

describe('linked task tag of every task from a specialist', () => {
  const ONE = { queue: { pipeline: 'feature', groups: [{ title: 'g', task: 't' }] } };

  async function exploreWith(h: Harness, tags: string[], title: string): Promise<string> {
    const added = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'explore',
      groups: [{ title: 'один', task: 'a' }],
      title,
      tags,
    })) as QueueView & { item: string };
    const created = (await h.call('queue_run_now', { repository: h.repo, item: added.item })) as {
      runId: string;
    };
    return created.runId;
  }

  it('gives the tasks of a run with a tag the tag of the run first, then the tags of the run', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({ explore: [{ queueChain: [ONE.queue, ONE.queue] }] });
    await addTag(h, 'bug');
    const explore = await exploreWith(h, ['bug'], 'Fix login');
    await h.waitFor(explore, (run) => run.finished);
    const items = (await queueOf(h)).items;
    expect(items).toHaveLength(2);
    for (const item of items) expect(names(item.tags)).toEqual(['fix-login', 'bug']);
    expect(names((await h.status(explore)).tags)).toEqual(['fix-login', 'bug']);
    expect((await tagsOf(h)).filter((tag) => tag.task)).toHaveLength(1);
  });

  it('puts the tag of each run before the tags it inherited along the chain', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({
      explore: [
        { queue: { pipeline: 'explore', groups: [{ title: 'g', task: 't' }] } },
        { queue: ONE.queue },
      ],
    });
    const first = await exploreWith(h, [], 'First');
    await h.waitFor(first, (run) => run.finished);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    for (const run of await allRuns(h)) await h.waitFor(run.id, (view) => view.finished);
    const runs = await allRuns(h);
    const chains = runs.map((run) => run.tags.map((tag) => tag.task?.run));
    expect(chains[0]).toEqual([first]);
    const ids = new Set(runs.map((run) => run.id));
    // a run made from a task of the second explore run: its tag, then the inherited one
    const deeper = chains.find((chain) => chain.length === 2);
    expect(deeper).toBeDefined();
    expect(deeper![1]).toBe(first);
    expect(deeper![0]).not.toBe(first);
    expect(ids.has(deeper![0]!)).toBe(true);
  });
});

describe('tags of several repositories', () => {
  it('puts the tag of the own repository on a run and refuses a tag of another one', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'only-here');
    const other = await secondRepo(h);
    const added = (await h.call('tag_add', { repository: other, name: 'auth' })) as TagView[];
    const run = await finishedRun(h, other, 'Task');
    const tagged = (await h.call('run_tags', { runId: run.id, add: ['auth'] })) as RunView;
    expect(tagged.tags.map((tag) => tag.id)).toEqual([added[0]!.id]);
    await expect(h.call('run_tags', { runId: run.id, add: ['only-here'] })).rejects.toThrow(
      'unknown tag `only-here`',
    );
    await expect(h.call('run_tags', { runId: run.id, remove: ['only-here'] })).rejects.toThrow(
      'unknown tag `only-here`',
    );
  });

  it('names a linked task tag without a suffix when the name is taken in another repository', async () => {
    const h = await start();
    await addTag(h, 'fix-login');
    const other = await secondRepo(h);
    const parent = await finishedRun(h, other, 'Fix login');
    await h.call('queue_add', {
      repository: other,
      pipeline: 'feature',
      task: 'child',
      parent: parent.id,
    });
    const linked = ((await h.call('tags', { repository: other })) as TagView[]).filter(
      (tag) => tag.task,
    );
    expect(names(linked)).toEqual(['fix-login']);
    expect(names(await tagsOf(h))).toEqual(['fix-login']);
  });

  it('renames a tag to a name used only in another repository', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'login');
    const other = await secondRepo(h);
    await h.call('tag_add', { repository: other, name: 'taken' });
    const renamed = (await h.call('tag_edit', {
      repository: h.repo,
      tag: 'login',
      name: 'taken',
    })) as TagView[];
    expect(names(renamed)).toEqual(['auth', 'taken']);
    await expect(
      h.call('tag_edit', { repository: h.repo, tag: 'auth', name: 'TAKEN' }),
    ).rejects.toThrow('already exists');
  });

  it('takes the default color from the catalog of the own repository', async () => {
    const h = await start();
    await addTag(h, 'a');
    await addTag(h, 'b');
    const other = await secondRepo(h);
    const first = (await h.call('tag_add', { repository: other, name: 'x' })) as TagView[];
    const mine = (await tagsOf(h))[0]!;
    expect(first[0]!.color).toBe(mine.color);
  });

  it('gives no tag and creates none for a parent from another repository', async () => {
    const h = await start();
    const other = await secondRepo(h);
    const parent = await finishedRun(h, other, 'Fix login');
    const view = (await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'child',
      parent: parent.id,
    })) as QueueView;
    expect(view.items[0]!.tags).toEqual([]);
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item: view.items[0]!.id,
      parent: parent.id,
    })) as QueueView;
    expect(edited.items[0]!.tags).toEqual([]);
    const run = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'x',
      parent: parent.id,
    })) as RunQueued;
    expect(run.item).toBeTruthy();
    expect(await h.call('tags', { repository: other })).toEqual([]);
    expect(await tagsOf(h)).toEqual([]);
    expect((await h.status(parent.id)).tags).toEqual([]);
  });
});
