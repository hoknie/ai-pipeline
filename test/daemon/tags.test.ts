import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type QueueView,
  type RunQueued,
  type RunView,
  type StreamEvent,
  type TagView,
} from '../../src/protocol/index.ts';

import { WORKFLOW_CONFIG, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SCOUT_CONFIG = `${WORKFLOW_CONFIG.replace(
  '  workflows:\n',
  '    scout: { name: Разведчик, queue: true }\n  workflows:\n    explore:\n      steps:\n        - { id: explore, specialist: scout }\n',
)}`;

async function start(config = WORKFLOW_CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

const tagsOf = async (h: Harness): Promise<TagView[]> => (await h.call('tags', {})) as TagView[];
const queueOf = async (h: Harness): Promise<QueueView> =>
  (await h.call('queue', { repository: h.repo })) as QueueView;
const names = (tags: { name: string }[]) => tags.map((tag) => tag.name);

async function addTag(h: Harness, name: string, color?: string): Promise<TagView[]> {
  return (await h.call('tag_add', { name, ...(color ? { color } : {}) })) as TagView[];
}

async function waitQueue(h: Harness, done: (queue: QueueView) => boolean): Promise<QueueView> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const queue = await queueOf(h);
    if (done(queue)) return queue;
    if (Date.now() > deadline) throw new Error(`timed out; queue: ${JSON.stringify(queue)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const allRuns = async (h: Harness): Promise<RunView[]> =>
  ((await h.call('status', {})) as RunView[]).sort((a, b) => a.createdAt - b.createdAt);

describe('tag catalog', () => {
  it('is empty at first', async () => {
    const h = await start();
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
    const h = await start();
    await addTag(h, 'auth');
    await expect(addTag(h, 'x'.repeat(31))).rejects.toThrow();
    await expect(addTag(h, ' AUTH ')).rejects.toThrow('tag `auth` already exists');
    await expect(addTag(h, 'other', '#ff0000')).rejects.toThrow('known: gray, red');
    expect(names(await tagsOf(h))).toEqual(['auth']);
  });

  it('gives the third tag the third color of the palette', async () => {
    const h = await start();
    await addTag(h, 'a');
    await addTag(h, 'b');
    const tags = await addTag(h, 'c');
    expect(tags.find((tag) => tag.name === 'c')?.color).toBe('orange');
  });

  it('renames a tag under the same id and changes the case of a name', async () => {
    const h = await start();
    const [created] = await addTag(h, 'auth', 'blue');
    const renamed = (await h.call('tag_edit', { tag: 'auth', name: 'login' })) as TagView[];
    expect(renamed).toEqual([{ ...created, name: 'login' }]);
    const recased = (await h.call('tag_edit', { tag: 'LOGIN', name: 'Login' })) as TagView[];
    expect(recased[0]?.name).toBe('Login');
  });

  it('shows a renamed tag on tasks and runs', async () => {
    const h = await start();
    await addTag(h, 'auth', 'blue');
    const queued = (await h.call('run', {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth'],
    })) as RunQueued;
    await h.call('tag_edit', { tag: 'auth', name: 'login', color: 'teal' });
    const view = await h.status(queued.run!.runId);
    expect(view.tags).toMatchObject([{ name: 'login', color: 'teal' }]);
    await h.waitFor(view.id, (run) => run.finished);
  });

  it('keeps one tag for tasks in two repositories', async () => {
    const h = await start();
    await addTag(h, 'auth');
    const other = join(h.repo, '..', 'lib');
    mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', other]);
    const first = (await h.call('queue_add', {
      repository: h.repo,
      workflow: 'feature',
      task: 'a',
      tags: ['auth'],
    })) as QueueView;
    // a second repository with its own configuration
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
    writeConfigDirectory(other, WORKFLOW_CONFIG);
    const second = (await h.call('queue_add', {
      repository: other,
      workflow: 'feature',
      task: 'b',
      tags: ['auth'],
    })) as QueueView;
    expect(first.items[0]?.tags[0]?.id).toBe(second.items[0]?.tags[0]?.id);
  });
});

describe('tag removal', () => {
  it('takes the tag off a waiting task and a finished run and does not bring it back', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const finished = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    });
    await h.waitFor(finished.runId, (run) => run.finished);
    await waitQueue(h, (queue) => queue.status === 'stopped');
    await h.call('queue_add', {
      repository: h.repo,
      workflow: 'feature',
      task: 'x',
      tags: ['auth', 'v2'],
    });
    const left = (await h.call('tag_remove', { tag: 'AUTH' })) as TagView[];
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
    await expect(h.call('tag_remove', { tag: 'nope' })).rejects.toThrow('unknown tag `nope`');
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshot = events[0];
    expect(
      snapshot?.event === 'snapshot' ? names(snapshot.tags as unknown as TagView[]) : null,
    ).toEqual(['old']);
    await addTag(h, 'auth');
    await h.call('tag_edit', { tag: 'auth', color: 'teal' });
    await h.call('tag_remove', { tag: 'old' });
    await new Promise((resolve) => setTimeout(resolve, 100));
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
      workflow: 'feature',
      groups: [{ title: 'g', task: 't' }],
    });
    await h.waitFor(created.runId, (run) => run.finished);
    const events: StreamEvent[] = [];
    subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await h.call('run_tags', { runId: created.runId, add: ['auth'] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const run = events.find((event) => event.event === 'run');
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
      workflow: 'feature',
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
        workflow: 'feature',
        task: 'x',
        tags: ['auth', 'nope'],
      }),
    ).rejects.toThrow('unknown tag `nope`; create it with `aip tag add nope`');
    expect((await queueOf(h)).items).toEqual([]);
    await expect(
      h.call('run', { repository: h.repo, workflow: 'feature', task: 'x', tags: ['nope'] }),
    ).rejects.toThrow('unknown tag');
    expect((await queueOf(h)).items).toEqual([]);
  });

  it('gives a started run the tags of its item', async () => {
    const h = await start();
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const created = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
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
      workflow: 'feature',
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
      workflow: 'feature',
      groups: [{ title: 'g', task: 't' }],
      tags: ['auth', 'v2'],
    })) as QueueView & { item: string };
    await h.call('tag_remove', { tag: 'auth' });
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
      workflow: 'feature',
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
      workflow: 'feature',
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
    workflow: 'explore',
    groups: [
      { title: 'один', task: 'a' },
      { title: 'два', task: 'b' },
    ],
  };

  async function exploreNow(h: Harness, tags: string[] | undefined): Promise<string> {
    const added = (await h.call('queue_add', {
      ...EXPLORE,
      repository: h.repo,
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
      explore: [{ queue: { workflow: 'feature', groups: [{ title: 'g', task: 't' }] } }],
    });
    await addTag(h, 'auth');
    await addTag(h, 'v2');
    const explore = await exploreNow(h, ['auth', 'v2']);
    await h.waitFor(explore, (run) => run.finished);
    // the queue is stopped, so the tasks wait
    const waiting = await queueOf(h);
    expect(waiting.items).toHaveLength(2);
    for (const item of waiting.items) expect(names(item.tags)).toEqual(['auth', 'v2']);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.status === 'stopped' && queue.items.length === 0);
    const runs = await allRuns(h);
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(names(run.tags)).toEqual(['auth', 'v2']);
    for (const run of runs) await h.waitFor(run.id, (view) => view.finished);
  });

  it('queues tasks without tags when the run has none, and creates no tags', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({
      explore: [{ queue: { workflow: 'feature', groups: [{ title: 'g', task: 't' }] } }],
    });
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    const waiting = await queueOf(h);
    expect(waiting.items).toHaveLength(2);
    for (const item of waiting.items) expect(item.tags).toEqual([]);
    expect(await tagsOf(h)).toEqual([]);
  });

  it('does not pass tags added to a run after its task was queued', async () => {
    const h = await start(SCOUT_CONFIG);
    h.script({
      explore: [{ queue: { workflow: 'feature', groups: [{ title: 'g', task: 't' }] } }],
    });
    await addTag(h, 'auth');
    const explore = await exploreNow(h, undefined);
    await h.waitFor(explore, (run) => run.finished);
    await h.call('run_tags', { runId: explore, add: ['auth'] });
    for (const item of (await queueOf(h)).items) expect(item.tags).toEqual([]);
    expect(names((await h.status(explore)).tags)).toEqual(['auth']);
  });
});
