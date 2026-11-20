import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addOrigin } from '../fixtures/origin.ts';
import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import type {
  Method,
  ParamsOf,
  QueueView,
  RunQueued,
  RunView,
  StatsReportView,
} from '../../src/presentation/ipc/contract/index.ts';

import { harness, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(server = true) {
  current = await harness();
  if (server) {
    addOrigin(current.repo);
    const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'settings.yaml'),
      'server: { enabled: true, public_url: "https://aip.example.com" }\n',
    );
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

async function user(h: Harness, email: string, attributes: Record<string, string[]>) {
  const link = (await as(h, undefined, 'login_link_create', { email })) as { url: string };
  const code = link.url.split('/auth/link/')[1] as string;
  const signed = (await as(h, undefined, 'auth_link_login', { code })) as { user: { id: string } };
  await as(h, undefined, 'users_set', { email, attributes });
  return signed.user.id;
}

async function refusal(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    return error as IpcError;
  }
  throw new Error('expected a refusal');
}

/** Two users with a finished run each. */
async function twoAuthors(h: Harness) {
  const alice = await user(h, 'alice@corp.com', { role: ['developer'] });
  const bob = await user(h, 'bob@corp.com', { role: ['developer'] });
  const runs: Record<string, string> = {};
  for (const [name, id] of [
    ['alice', alice],
    ['bob', bob],
  ] as const) {
    const queued = (await as(h, id, 'run', {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: name, task: name }],
    })) as RunQueued;
    runs[name] = queued.run!.runId;
    await h.waitFor(runs[name]!, (view) => view.finished);
  }
  await until(
    'the statistics of both runs',
    async () =>
      ((await as(h, undefined, 'stats_report', {})) as StatsReportView).totals.tasks === 2,
  );
  return { alice, bob, runs };
}

describe('the directory of users', () => {
  it('gives every signed in role the id, the email and the name, and no attributes', async () => {
    const h = await start();
    const alice = await user(h, 'alice@corp.com', { role: ['developer'] });
    const viewer = await user(h, 'viewer@corp.com', { role: ['viewer'] });
    for (const actor of [alice, viewer, undefined]) {
      const { users } = (await as(h, actor, 'users_directory', {})) as {
        users: Record<string, unknown>[];
      };
      expect(users.map((entry) => Object.keys(entry).sort())).toEqual([
        ['email', 'id', 'name'],
        ['email', 'id', 'name'],
      ]);
      expect(users.map((entry) => entry.email).sort()).toEqual([
        'alice@corp.com',
        'viewer@corp.com',
      ]);
    }
  });

  it('is refused without a role and in the local mode', async () => {
    const h = await start();
    const nobody = await user(h, 'nobody@corp.com', {});
    expect((await refusal(as(h, nobody, 'users_directory', {}))).remoteCode).toBe('access.denied');
    await h.close();
    const local = await start(false);
    await refusal(as(local, undefined, 'users_directory', {}));
  });
});

describe('the report and the lists by author', () => {
  it('counts only the runs of the author with `me`, and breaks the usage down by author', async () => {
    const h = await start();
    const { alice, bob } = await twoAuthors(h);
    const all = (await as(h, undefined, 'stats_report', {})) as StatsReportView;
    expect(all.byAuthor?.map((row) => row.email).sort()).toEqual([
      'alice@corp.com',
      'bob@corp.com',
    ]);
    expect(all.byAuthor?.every((row) => row.name !== null)).toBe(true);
    const mine = (await as(h, bob, 'stats_report', { author: 'me' })) as StatsReportView;
    expect(mine.totals.tasks).toBe(1);
    expect(mine.byAuthor?.map((row) => row.key)).toEqual([bob]);
    const other = (await as(h, bob, 'stats_report', { author: alice })) as StatsReportView;
    expect(other.byAuthor?.map((row) => row.key)).toEqual([alice]);
  });

  it('refuses `me` from the local actor and any author in the local mode, and has no breakdown there', async () => {
    const h = await start();
    expect((await refusal(as(h, undefined, 'stats_report', { author: 'me' }))).message).toContain(
      'signed in user',
    );
    await h.close();
    const local = await start(false);
    const report = (await as(local, undefined, 'stats_report', {})) as StatsReportView;
    expect(report.byAuthor).toBeUndefined();
    await refusal(as(local, undefined, 'stats_report', { author: 'me' }));
    await refusal(as(local, undefined, 'status', { author: 'x' }));
    await refusal(as(local, undefined, 'finished_runs', { author: 'x', limit: 15 }));
    await refusal(as(local, undefined, 'queue', { repository: local.repo, author: 'x' }));
  });

  it('lists only the runs of the author, active and finished', async () => {
    const h = await start();
    const { alice, bob, runs } = await twoAuthors(h);
    const recent = (await as(h, bob, 'status', { author: 'me' })) as RunView[];
    expect(recent.map((run) => run.id)).toEqual([runs.bob]);
    const page = (await as(h, bob, 'finished_runs', { author: alice, limit: 15 })) as {
      runs: RunView[];
    };
    expect(page.runs.map((run) => run.id)).toEqual([runs.alice]);
    const everyone = (await as(h, bob, 'finished_runs', { limit: 15 })) as { runs: RunView[] };
    expect(everyone.runs).toHaveLength(2);
  });

  it('lists only the tasks of the author in the queue and leaves the queue itself as it is', async () => {
    const h = await start();
    const alice = await user(h, 'alice@corp.com', { role: ['developer'] });
    const bob = await user(h, 'bob@corp.com', { role: ['developer'] });
    for (const [actor, task] of [
      [alice, 'a1'],
      [bob, 'b1'],
      [alice, 'a2'],
    ] as const) {
      await as(h, actor, 'queue_add', { repository: h.repo, pipeline: 'feature', task });
    }
    const mine = (await as(h, alice, 'queue', { repository: h.repo, author: 'me' })) as QueueView;
    expect(mine.items.map((item) => item.task)).toEqual(['a1', 'a2']);
    const full = (await as(h, alice, 'queue', { repository: h.repo })) as QueueView;
    expect(full.items.map((item) => item.task)).toEqual(['a1', 'b1', 'a2']);
  });
});
