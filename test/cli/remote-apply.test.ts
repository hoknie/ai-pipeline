import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AuditEventView, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/index.ts';
import { CODE_ONLY_CONFIG, until } from '../daemon/harness.ts';

import { aip, ownDaemon, runOf, sandbox, type Sandbox } from './sandbox.ts';

let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  web = null;
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Setup {
  server: Sandbox;
  bare: string;
  /** The clone of bob: another directory, the same origin. */
  developer: Sandbox;
  admin: Sandbox;
}

/** The server with its clone and a bare origin, bob with his own clone of origin, and an administrator. */
async function setup(): Promise<Setup> {
  const box = sandbox(CODE_ONLY_CONFIG);
  await ownDaemon(box);
  writeFileSync(
    String(box.env.AIP_FAKE_SCRIPT),
    JSON.stringify({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] }),
  );
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-remote-apply-')));
  const bare = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git(box.repo, 'remote', 'add', 'origin', bare);
  git(box.repo, 'push', '-q', 'origin', 'main');
  const clone = join(base, 'bob');
  execFileSync('git', ['clone', '-q', bare, clone], { stdio: 'ignore' });
  git(clone, 'config', 'user.name', 'Bob');
  git(clone, 'config', 'user.email', 'bob@corp.com');
  await request(box.socket, 'repository_add', { path: box.repo });
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
  const userOf = async (email: string, name: string, admin = false): Promise<Sandbox> => {
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
  const bob = await userOf('bob@corp.com', 'Bob');
  const admin = await userOf('admin@corp.com', 'Admin', true);
  return { server: box, bare, developer: { ...bob, repo: clone }, admin };
}

/** Bob starts a run and waits until the server has sent its branch to origin. */
async function sentRun(s: Setup): Promise<string> {
  const started = await aip(
    s.developer,
    ...['run', 'start', 'feature', '--task', 'work', '--repo', 'repo', '--json'],
  );
  expect(started.stderr).toBe('');
  const runId = runOf(started.stdout).runId;
  await until('the branch in origin', async () => {
    const view = (await request(s.server.socket, 'status', { runId })) as RunView;
    return view.remoteBranch !== null;
  });
  return runId;
}

/** The `run.apply` entries of the journal: what the developers reported as applied. */
async function applied(s: Setup): Promise<string[]> {
  const journal = await aip(s.admin, 'audit', '--since', '1d', '--json');
  return (JSON.parse(journal.stdout) as AuditEventView[])
    .filter((event) => event.action === 'run.apply')
    .map((event) => `${event.user?.email} ${event.resourceId} ${event.outcome}`);
}

describe('aip run apply with a server profile', () => {
  it('puts the changes of the run uncommitted into the clone of the developer', async () => {
    const s = await setup();
    const runId = await sentRun(s);
    const head = git(s.developer.repo, 'rev-parse', 'HEAD');
    const result = await aip(s.developer, 'run', 'apply', runId);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('applied');
    expect(readFileSync(join(s.developer.repo, 'lib.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
    expect(git(s.developer.repo, 'status', '--porcelain')).toBe('?? lib.ts');
    expect(git(s.developer.repo, 'rev-parse', 'HEAD')).toBe(head);
    // the server counts the run delivered, its own working tree is untouched, the journal names bob
    expect((await view(s, runId)).delivery).toMatchObject({ applied: 1, merged: 1 });
    expect(git(s.server.repo, 'status', '--porcelain')).toBe('');
    expect(await applied(s)).toEqual([`bob@corp.com ${runId} ok`]);
  });

  it('commits with the identity of the developer in the commit mode', async () => {
    const s = await setup();
    const runId = await sentRun(s);
    const result = await aip(s.developer, 'run', 'apply', runId, '--mode', 'commit');
    expect(result.code).toBe(0);
    expect(git(s.developer.repo, 'status', '--porcelain')).toBe('');
    expect(git(s.developer.repo, 'log', '-1', '--format=%an <%ae> %cn <%ce>')).toBe(
      'Bob <bob@corp.com> Bob <bob@corp.com>',
    );
    expect(readFileSync(join(s.developer.repo, 'lib.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
  });

  it('refuses a conflict with the edits of the developer, changes nothing and marks nothing', async () => {
    const s = await setup();
    const runId = await sentRun(s);
    writeFileSync(join(s.developer.repo, 'lib.ts'), 'export const value = 9;\n');
    const refused = await aip(s.developer, 'run', 'apply', runId);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain('conflict');
    expect(readFileSync(join(s.developer.repo, 'lib.ts'), 'utf8')).toBe(
      'export const value = 9;\n',
    );
    expect(await applied(s)).toEqual([]);
    // --force applies with the markers
    const forced = await aip(s.developer, 'run', 'apply', runId, '--force');
    expect(forced.code).toBe(0);
    expect(await applied(s)).toEqual([`bob@corp.com ${runId} ok`]);
    expect(readFileSync(join(s.developer.repo, 'lib.ts'), 'utf8')).toContain('<<<<<<<');
  });

  it('does not take groups, and a mode only with a profile', async () => {
    const s = await setup();
    const runId = await sentRun(s);
    const named = await aip(s.developer, 'run', 'apply', runId, 'work');
    expect(named.code).not.toBe(0);
    expect(named.stderr).toContain('groups cannot be named');
    expect((await aip(s.developer, 'run', 'apply', runId, '--mode', 'branch')).code).not.toBe(0);
    expect(await applied(s)).toEqual([]);
    const local = await aip(s.server, 'run', 'apply', runId, '--mode', 'commit');
    expect(local.stderr).toContain('--mode works only with a server profile');
  });

  it('refuses a run whose branch is not in origin', async () => {
    const s = await setup();
    git(s.server.repo, 'remote', 'set-url', '--push', 'origin', join(s.bare, 'nonexistent'));
    const started = await aip(
      s.developer,
      ...['run', 'start', 'feature', '--task', 'work', '--repo', 'repo', '--json'],
    );
    const runId = runOf(started.stdout).runId;
    await until('the failed push', async () => {
      return (await view(s, runId)).deliveryStage?.status === 'push_failed';
    });
    const refused = await aip(s.developer, 'run', 'apply', runId);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('not in the remote repository');
    expect(git(s.developer.repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses a clone that has no remote with the address of the project', async () => {
    const s = await setup();
    const runId = await sentRun(s);
    git(s.developer.repo, 'remote', 'remove', 'origin');
    const refused = await aip(s.developer, 'run', 'apply', runId);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('no git remote');
    expect(await applied(s)).toEqual([]);
  });
});

const view = async (s: Setup, runId: string) =>
  (await request(s.server.socket, 'status', { runId })) as RunView;
