import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StatsRecordRepository } from '../../src/feature/stats/repositories/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import type {
  QueueView,
  RunView,
  StatsReportView,
} from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { attemptRecord, taskRecord } from '../feature/stats/helpers.ts';
import { CODE_ONLY_CONFIG, until } from '../daemon/harness.ts';

import { aip, ownDaemon, runOf, sandbox, type Sandbox } from './sandbox.ts';

let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  web = null;
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** A server with the panel; the returned function makes the environment of a user of the CLI. */
async function serverMode(box: Sandbox) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const directory = join(String(box.env.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'settings.yaml'),
    `server: { enabled: true, public_url: "${url}", default_role: developer }\n`,
  );
  web = await startWebServer({
    socket: box.socket,
    host: '127.0.0.1',
    port,
    server: { publicUrl: url, trustedProxies: [] },
  });
  return async (email: string, name: string): Promise<{ box: Sandbox; id: string }> => {
    const made = (await request(box.socket, 'login_link_create', { email, name })) as {
      url: string;
    };
    const answer = await fetch(made.url, { redirect: 'manual' });
    const cookie = (answer.headers.get('set-cookie') as string).split(';')[0] as string;
    const token = await fetch(`${url}/api/ipc`, {
      method: 'POST',
      headers: { cookie, origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tokens_create', params: { name: 'cli' } }),
    });
    const { value } = (await token.json()) as { value: string };
    const users = (await request(box.socket, 'users_list', {})) as {
      users: { id: string; email: string }[];
    };
    const id = users.users.find((user) => user.email === email)!.id;
    return { box: { ...box, env: { ...box.env, AIP_SERVER: url, AIP_TOKEN: value } }, id };
  };
}

describe('the author filters of the CLI in the server mode', () => {
  it('lists the runs and the queue of one author, and reports by author', async () => {
    const box = sandbox(CODE_ONLY_CONFIG);
    const daemon = await ownDaemon(box);
    await request(box.socket, 'repository_add', { path: box.repo });
    const userOf = await serverMode(box);
    const alice = await userOf('alice@corp.com', 'Alice');
    const bob = await userOf('bob@corp.com', 'Bob');

    const start = ['run', 'start', 'feature', '--task', 'work', '--repo', 'repo', '--json'];
    const runs: string[] = [];
    for (const who of [alice, bob]) {
      const started = await aip(who.box, ...start);
      expect(started.stderr).toBe('');
      const runId = runOf(started.stdout).runId;
      runs.push(runId);
      await until('the run to finish', async () => {
        const view = (await request(box.socket, 'status', { runId })) as RunView[] | RunView;
        return (Array.isArray(view) ? view[0] : view)?.finished === true;
      });
    }
    const ids = async (who: Sandbox, ...args: string[]) =>
      (JSON.parse((await aip(who, 'run', 'list', '--json', ...args)).stdout) as RunView[]).map(
        (run) => run.id,
      );
    expect(await ids(bob.box, '--mine')).toEqual([runs[1]]);
    expect(await ids(bob.box, '--author', 'alice@corp.com')).toEqual([runs[0]]);
    expect((await ids(bob.box)).sort()).toEqual([...runs].sort());

    const refused = await aip(bob.box, 'run', 'list', '--mine', '--author', 'alice@corp.com');
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('cannot be combined');
    const unknown = await aip(bob.box, 'run', 'list', '--author', 'nobody@corp.com');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('unknown user');

    await aip(alice.box, 'queue', 'add', 'feature', '--task', 'a1', '--repo', 'repo');
    await aip(bob.box, 'queue', 'add', 'feature', '--task', 'b1', '--repo', 'repo');
    const tasks = async (who: Sandbox, ...args: string[]) =>
      (
        JSON.parse(
          (await aip(who, 'queue', 'list', '--repo', 'repo', '--json', ...args)).stdout,
        ) as QueueView
      ).items.map((item) => item.task);
    expect(await tasks(alice.box, '--mine')).toEqual(['a1']);
    expect(await tasks(alice.box, '--author', 'bob@corp.com')).toEqual(['b1']);
    expect(await tasks(alice.box)).toEqual(['a1', 'b1']);
    expect((await aip(alice.box, 'queue', 'list', '--mine', '--author', 'x@y.z')).code).not.toBe(0);

    const records = new StatsRecordRepository(daemon.application.database);
    const at = Date.now() - 60_000;
    for (const [runId, who, tokens] of [
      ['s-alice', alice.id, 80_000],
      ['s-bob', bob.id, 20_000],
    ] as const) {
      records.insertAttempts([
        attemptRecord({
          runId,
          repository: box.repo,
          author: who,
          inputTokens: tokens,
          outputTokens: 0,
          finishedAt: at,
        }),
      ]);
      records.upsertTask(taskRecord({ runId, repository: box.repo, author: who, finishedAt: at }));
    }
    const mine = JSON.parse(
      (await aip(bob.box, 'stats', '--author', 'me', '--json')).stdout,
    ) as StatsReportView;
    expect(mine.byAuthor?.map((row) => row.email)).toEqual(['bob@corp.com']);
    const theirs = JSON.parse(
      (await aip(bob.box, 'stats', '--author', 'alice@corp.com', '--since', '7d', '--json')).stdout,
    ) as StatsReportView;
    expect(theirs.totals.tokens).toBeGreaterThanOrEqual(80_000);
    expect(theirs.byAuthor?.map((row) => row.email)).toEqual(['alice@corp.com']);
    const text = await aip(bob.box, 'stats');
    expect(text.stdout).toMatch(/author\s+attempts/);
    expect(text.stdout).toContain('alice@corp.com');
    expect((await aip(bob.box, 'stats', '--author', 'nobody@corp.com')).code).not.toBe(0);
  });

  it('is refused in the local mode', async () => {
    const box = sandbox(CODE_ONLY_CONFIG);
    await ownDaemon(box);
    for (const args of [
      ['run', 'list', '--mine'],
      ['queue', 'list', '--mine'],
      ['stats', '--author', 'me'],
      ['run', 'list', '--author', 'a@b.c'],
    ]) {
      const result = await aip(box, ...args);
      expect(result.code, args.join(' ')).not.toBe(0);
    }
  });
});
