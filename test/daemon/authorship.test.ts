import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addOrigin } from '../fixtures/origin.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import type {
  Method,
  ParamsOf,
  QueueView,
  RunView,
} from '../../src/presentation/ipc/contract/index.ts';

import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { CODE_ONLY_CONFIG, harness, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SERVER =
  'server: { enabled: true, public_url: "https://aip.example.com", default_role: developer }\n';

async function start(serverMode: boolean): Promise<Harness> {
  current = await harness();
  if (serverMode) {
    addOrigin(current.repo);
    const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), SERVER);
  }
  return current;
}

function as<M extends Method>(
  h: Harness,
  actor: string | undefined,
  method: M,
  params: ParamsOf<M>,
) {
  return request(h.socket, method, params, 30_000, actor);
}

async function signIn(h: Harness, email: string): Promise<string> {
  const link = (await as(h, undefined, 'login_link_create', { email, admin: false })) as {
    url: string;
  };
  const code = link.url.split('/auth/link/')[1] as string;
  const signed = (await as(h, undefined, 'auth_link_login', { code })) as { user: { id: string } };
  return signed.user.id;
}

const task = (extra: Record<string, unknown> = {}) =>
  ({ repository: '', pipeline: 'feature', task: 'work', ...extra }) as never;

describe('the author of a task and of a run', () => {
  it('is the user who added the task; an edit by another user does not change it', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    const bob = await signIn(h, 'bob@corp.com');
    const added = (await as(
      h,
      alice,
      'queue_add',
      task({ repository: h.repo, title: 'A' }),
    )) as QueueView & {
      item: string;
    };
    expect(added.items[0]).toMatchObject({
      id: added.item,
      author: { id: alice, email: 'alice@corp.com', disabled: false },
    });
    await as(h, bob, 'queue_edit', { repository: h.repo, item: added.item, title: 'Changed' });
    const queue = (await as(h, bob, 'queue', { repository: h.repo })) as QueueView;
    expect(queue.items[0]).toMatchObject({ title: 'Changed', author: { email: 'alice@corp.com' } });
  });

  it('goes from the task to its run, even when another user starts the queue', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    const bob = await signIn(h, 'bob@corp.com');
    h.script({ code: [{}, {}] });
    await as(h, alice, 'queue_add', task({ repository: h.repo, title: 'A' }));
    await as(h, bob, 'queue_start', { repository: h.repo });
    await until('the run of the task', async () => {
      const runs = (await as(h, bob, 'status', {})) as RunView[];
      return runs.length === 1;
    });
    const runs = (await as(h, bob, 'status', {})) as RunView[];
    expect(runs[0]?.author).toMatchObject({ id: alice, email: 'alice@corp.com' });
  });

  it('is the author of a task from `queue_add_projects`, and null for the system', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    const other = join(dirname(h.repo), 'other');
    copyTemplateRepo(other, CODE_ONLY_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    addOrigin(other);
    await h.call('repository_add', { path: h.repo });
    await h.call('repository_add', { path: other });
    const many = (await as(h, alice, 'queue_add_projects', {
      repositories: [h.repo, other],
      pipeline: 'feature',
      task: 'Everywhere',
    })) as { item: string }[];
    expect(many).toHaveLength(2);
    await as(h, undefined, 'queue_add', task({ repository: h.repo, title: 'S' }));
    const queue = (await as(h, undefined, 'queue', { repository: h.repo })) as QueueView;
    const byId = new Map(queue.items.map((item) => [item.id, item.author]));
    expect(byId.get(many[0]!.item)).toMatchObject({ id: alice });
    expect(queue.items.filter((item) => item.author === null)).toHaveLength(1);
  });

  it('is the author of a task from `run`', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    h.script({ code: [{}, {}] });
    await as(h, alice, 'run', task({ repository: h.repo }));
    await until('the run of the task', async () => {
      const runs = (await as(h, undefined, 'status', {})) as RunView[];
      return runs.length === 1;
    });
    const runs = (await as(h, undefined, 'status', {})) as RunView[];
    expect(runs[0]?.author).toMatchObject({ id: alice });
  });

  it('marks a task of the system, not a user, and the run takes the mark', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    h.script({ code: [{}, {}] });
    await as(h, alice, 'queue_add', task({ repository: h.repo, title: 'A' }));
    await as(h, undefined, 'queue_add', task({ repository: h.repo, title: 'S' }));
    const queue = (await as(h, undefined, 'queue', { repository: h.repo })) as QueueView;
    const own = queue.items.find((item) => item.title === 'A');
    const system = queue.items.find((item) => item.title === 'S');
    expect(own).toMatchObject({ createdBySystem: false, author: { id: alice } });
    expect(system).toMatchObject({ createdBySystem: true, author: null });
    await as(h, undefined, 'queue_remove', { repository: h.repo, item: own!.id });
    await as(h, undefined, 'queue_start', { repository: h.repo });
    await until('the run of the task', async () => {
      const runs = (await as(h, undefined, 'status', {})) as RunView[];
      return runs.length === 1;
    });
    const runs = (await as(h, undefined, 'status', {})) as RunView[];
    expect(runs[0]).toMatchObject({ createdBySystem: true, author: null });
  });

  it('keeps the mark of a user task off: the run of alice is not by the system', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    h.script({ code: [{}, {}] });
    await as(h, alice, 'run', task({ repository: h.repo }));
    await until('the run of the task', async () => {
      const runs = (await as(h, undefined, 'status', {})) as RunView[];
      return runs.length === 1;
    });
    const runs = (await as(h, undefined, 'status', {})) as RunView[];
    expect(runs[0]).toMatchObject({ createdBySystem: false, author: { id: alice } });
  });

  it('is empty in the local mode', async () => {
    const h = await start(false);
    await h.call('queue_add', task({ repository: h.repo, title: 'L' }));
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.items[0]?.author).toBeNull();
    expect(queue.items[0]?.createdBySystem).toBe(false);
  });
});
