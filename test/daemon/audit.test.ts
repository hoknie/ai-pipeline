import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addOrigin } from '../fixtures/origin.ts';
import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import type {
  AuditView,
  Method,
  ParamsOf,
  RunView,
} from '../../src/presentation/ipc/contract/index.ts';

import { harness, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SERVER =
  'server: { enabled: true, public_url: "https://aip.example.com", default_role: developer }\n';

async function start(serverMode: boolean, extra = ''): Promise<Harness> {
  current = await harness();
  if (serverMode) {
    addOrigin(current.repo);
    const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'settings.yaml'), SERVER + extra);
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

async function signIn(h: Harness, email: string, admin = false): Promise<string> {
  const link = (await as(h, undefined, 'login_link_create', { email, admin })) as { url: string };
  const code = link.url.split('/auth/link/')[1] as string;
  const signed = (await as(h, undefined, 'auth_link_login', {
    code,
    address: '203.0.113.7',
  } as never)) as {
    user: { id: string };
  };
  return signed.user.id;
}

const journal = async (h: Harness, params: ParamsOf<'audit_list'> = {}) =>
  ((await as(h, undefined, 'audit_list', params)) as AuditView).events;

describe('the audit journal of the server mode', () => {
  it('records the cancel of a run of another user, and no reads', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    const bob = await signIn(h, 'bob@corp.com');
    h.script({ code: [{ waitFor: h.gate('hold') }, {}] });
    await as(h, alice, 'run', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await until(
      'the run',
      async () => ((await as(h, bob, 'status', {})) as RunView[]).length === 1,
    );
    const runId = ((await as(h, bob, 'status', {})) as RunView[])[0]!.id;
    const before = (await journal(h)).length;
    await as(h, bob, 'status', {});
    await as(h, bob, 'queues', {});
    expect(await journal(h)).toHaveLength(before);
    await as(h, bob, 'cancel', { runId });
    const [last] = await journal(h, { action: 'run.cancel' });
    expect(last).toMatchObject({
      subject: bob,
      user: { email: 'bob@corp.com' },
      action: 'run.cancel',
      repository: h.repo,
      resourceKind: 'run',
      resourceId: runId,
      outcome: 'ok',
    });
    h.open('hold');
  });

  it('records a refused call as denied, and the shared level apart from the project', async () => {
    const h = await start(true);
    const bob = await signIn(h, 'bob@corp.com');
    const shared = { repository: h.repo, path: 'delivery.auto', value: false, revision: null };
    await expect(
      as(h, bob, 'config_setting', { ...shared, level: 'global' }),
    ).rejects.toBeInstanceOf(IpcError);
    await as(h, bob, 'config_setting', { ...shared, level: 'project' });
    await as(h, undefined, 'config_setting', { ...shared, level: 'global' });
    const entries = await journal(h, { action: 'config.' });
    expect(entries.map((entry) => [entry.action, entry.outcome, entry.repository])).toEqual([
      ['config.global.write', 'ok', null],
      ['config.write', 'ok', h.repo],
      ['config.global.write', 'denied', null],
    ]);
    expect(entries[2]?.subject).toBe(bob);
  });

  it('records a failed call with the text of the error', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    await expect(as(h, alice, 'cancel', { runId: 'nope' })).rejects.toBeInstanceOf(IpcError);
    const [entry] = await journal(h, { action: 'run.cancel' });
    expect(entry?.outcome).toBe('failed');
    expect(entry?.error).toBeTruthy();
  });

  it('records the answer to a question with its group and text', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    await expect(
      as(h, alice, 'answer', { runId: 'nope', group: 'login', answer: 'use OAuth' }),
    ).rejects.toBeInstanceOf(IpcError);
    const [entry] = await journal(h, { action: 'run.answer' });
    expect(entry?.details).toMatchObject({ group: 'login', answer: 'use OAuth' });
  });

  it('records the events of sign-in and of accounts without the secrets', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    await expect(
      as(h, undefined, 'auth_link_login', { code: 'wrong', address: '198.51.100.9' } as never),
    ).rejects.toBeInstanceOf(IpcError);
    const created = (await as(h, alice, 'tokens_create', { name: 'laptop' })) as { value: string };
    await as(h, undefined, 'users_disable', { email: 'alice@corp.com' });
    await as(h, undefined, 'users_enable', { email: 'alice@corp.com' });
    const entries = await journal(h);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'login_link.create',
        'auth.login',
        'auth.login_failed',
        'token.create',
        'user.disable',
        'user.enable',
      ]),
    );
    const login = entries.find((entry) => entry.action === 'auth.login');
    expect(login).toMatchObject({
      subject: alice,
      details: { method: 'link', address: '203.0.113.7' },
    });
    const failed = entries.find((entry) => entry.action === 'auth.login_failed');
    expect(failed).toMatchObject({ outcome: 'failed', details: { address: '198.51.100.9' } });
    expect(failed?.details.reason).toBeTruthy();
    const token = entries.find((entry) => entry.action === 'token.create');
    expect(token?.details).toMatchObject({ name: 'laptop' });
    expect(JSON.stringify(entries)).not.toContain(created.value);
  });

  it('is not kept in the local mode, and cannot be read there', async () => {
    const h = await start(false);
    await h.call('queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await expect(h.call('audit_list', {})).rejects.toThrow(/server mode is off/);
    const row = h.running.application.database
      .prepare('SELECT COUNT(*) AS n FROM audit_events')
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('records the sign-out with the user of the session and the address', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    const link = (await as(h, undefined, 'login_link_create', {
      email: 'alice@corp.com',
      admin: false,
    })) as { url: string };
    const code = link.url.split('/auth/link/')[1] as string;
    const signed = (await as(h, undefined, 'auth_link_login', {
      code,
      address: '203.0.113.7',
    } as never)) as { session: string };
    await as(h, undefined, 'auth_logout', {
      session: signed.session,
      address: '203.0.113.8',
    } as never);
    const [entry] = await journal(h, { action: 'auth.logout' });
    expect(entry).toMatchObject({
      subject: alice,
      details: { method: 'session', address: '203.0.113.8' },
    });
  });

  it('refuses the reading to a user who is not an administrator', async () => {
    const h = await start(true);
    const bob = await signIn(h, 'bob@corp.com');
    const error = await as(h, bob, 'audit_list', {}).catch((e: unknown) => e as IpcError);
    expect((error as IpcError).remoteCode).toBe('access.denied');
  });

  it('filters by user, project and period, and refuses a bad period', async () => {
    const h = await start(true);
    const alice = await signIn(h, 'alice@corp.com');
    await as(h, alice, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    expect((await journal(h, { user: 'alice@corp.com', action: 'queue.' })).length).toBe(1);
    expect(await journal(h, { user: 'nobody@corp.com' }).catch(() => 'rejected')).toBe('rejected');
    expect((await journal(h, { repository: h.repo, since: '1d' })).map((e) => e.action)).toEqual([
      'queue.add',
    ]);
    expect(await journal(h, { since: 'soon' }).catch(() => 'rejected')).toBe('rejected');
  });
});
