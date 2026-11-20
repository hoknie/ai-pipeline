import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addOrigin } from '../fixtures/origin.ts';
import type { AuditEventView, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
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

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A server with the panel, and the CLI of a user: the environment with a personal token. */
async function serverMode(box: Sandbox) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  addOrigin(box.repo);
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
  return async (email: string, name: string, admin = false): Promise<Sandbox> => {
    const made = (await request(box.socket, 'login_link_create', { email, name, admin })) as {
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
    return { ...box, env: { ...box.env, AIP_SERVER: url, AIP_TOKEN: value } };
  };
}

describe('authorship and the audit journal, from the CLI to the commit', () => {
  it('alice adds tasks, bob cancels one, the administrator sees both, the commit is by alice', async () => {
    const box = sandbox(`${CODE_ONLY_CONFIG}  delivery: { mode: branch }\n`);
    await ownDaemon(box);
    // the first agent waits for the gate (the run is cancelled meanwhile); the next ones write
    const gate = join(dirname(box.repo), 'gate');
    writeFileSync(
      String(box.env.AIP_FAKE_SCRIPT),
      JSON.stringify({
        code: [
          { waitFor: gate, write: { 'lib.ts': 'export const value = 2;\n' } },
          { write: { 'lib.ts': 'export const value = 2;\n' } },
        ],
      }),
    );
    await request(box.socket, 'repository_add', { path: box.repo });
    const userOf = await serverMode(box);
    const alice = await userOf('alice@corp.com', 'Alice');
    const bob = await userOf('bob@corp.com', 'Bob');
    const admin = await userOf('admin@corp.com', 'Admin', true);
    const finished = async (runId: string) =>
      until('the run to finish', async () => {
        const view = (await request(box.socket, 'status', { runId })) as RunView[] | RunView;
        return (Array.isArray(view) ? view[0] : view)?.finished === true;
      });

    const start = ['run', 'start', 'feature', '--task', 'work', '--repo', 'repo', '--json'];
    const first = await aip(alice, ...start);
    expect(first.stderr).toBe('');
    const cancelled = runOf(first.stdout).runId;
    const shown = await aip(bob, 'run', 'show', cancelled, '--json');
    expect(JSON.parse(shown.stdout)).toMatchObject({ author: { email: 'alice@corp.com' } });
    expect((await aip(bob, 'run', 'cancel', cancelled)).code).toBe(0);
    await finished(cancelled);

    writeFileSync(gate, 'open');
    const second = await aip(alice, ...start);
    const runId = runOf(second.stdout).runId;
    await finished(runId);
    // the server sent the branch to origin; alice applies it in her own clone
    await until('the branch in origin', async () => {
      const view = (await request(box.socket, 'status', { runId })) as RunView;
      return view.remoteBranch !== null;
    });
    const clone = join(dirname(box.repo), 'alice');
    execFileSync('git', ['clone', '-q', git(box.repo, 'remote', 'get-url', 'origin'), clone], {
      stdio: 'ignore',
    });
    expect((await aip({ ...alice, repo: clone }, 'run', 'apply', runId)).code).toBe(0);

    const journal = await aip(admin, 'audit', '--since', '1d', '--json');
    expect(journal.code).toBe(0);
    const events = JSON.parse(journal.stdout) as AuditEventView[];
    const seen = events.map((event) => `${event.user?.email} ${event.action} ${event.outcome}`);
    expect(seen).toContain('bob@corp.com run.cancel ok');
    expect(seen.filter((line) => line === 'alice@corp.com run.start ok')).toHaveLength(2);
    expect(seen).toContain('alice@corp.com run.apply ok');
    expect(events.find((event) => event.action === 'run.cancel')).toMatchObject({
      resourceKind: 'run',
      resourceId: cancelled,
    });

    const branch = `aip/${runId}`;
    expect(git(box.repo, 'log', '-1', '--format=%an <%ae>', branch)).toBe('Alice <alice@corp.com>');
    expect(git(box.repo, 'log', '-1', '--format=%ae', branch)).not.toBe(
      git(box.repo, 'log', '-1', '--format=%ce', branch),
    );
    expect(git(box.repo, 'show', `${branch}:lib.ts`)).toBe('export const value = 2;');

    expect((await aip(bob, 'audit')).code).not.toBe(0);
  });
});
