import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import type { Method, ParamsOf } from '../../src/presentation/ipc/contract/index.ts';

import { harness, type Harness } from './harness.ts';

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

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    return error as IpcError;
  }
  throw new Error('expected a rejection');
}

interface Signed {
  session: string;
  user: { id: string };
}

async function signIn(h: Harness, email: string, admin: boolean): Promise<Signed> {
  const link = (await as(h, undefined, 'login_link_create', { email, admin })) as { url: string };
  const code = link.url.split('/auth/link/')[1] as string;
  return (await as(h, undefined, 'auth_link_login', { code })) as Signed;
}

describe('local mode', () => {
  it('refuses the methods of users and tokens', async () => {
    const h = await start(false);
    for (const [method, params] of [
      ['users_list', {}],
      ['tokens_list', {}],
      ['login_link_create', { email: 'a@example.com' }],
    ] as const) {
      const error = await rejection(as(h, undefined, method, params as never));
      expect(error.message).toMatch(/server mode is off/);
    }
  });

  it('ignores the actor of the envelope', async () => {
    const h = await start(false);
    await expect(as(h, 'nobody', 'status', {})).resolves.toBeDefined();
  });
});

describe('server mode', () => {
  it('runs a request without an actor as the system', async () => {
    const h = await start(true);
    await expect(as(h, undefined, 'status', {})).resolves.toBeDefined();
    const link = (await as(h, undefined, 'login_link_create', {
      email: 'admin@example.com',
      admin: true,
    })) as { url: string };
    expect(link.url).toMatch(/^https:\/\/aip\.example\.com\/auth\/link\/.+/);
  });

  it('signs a user in by a link and resolves the session', async () => {
    const h = await start(true);
    const signed = await signIn(h, 'admin@example.com', true);
    const resolved = (await as(h, undefined, 'auth_resolve', { session: signed.session })) as {
      user: { email: string; admin: boolean };
    };
    expect(resolved.user).toMatchObject({ email: 'admin@example.com', admin: true });
    expect(
      ((await as(h, undefined, 'auth_resolve', { session: 'nope' })) as { user: unknown }).user,
    ).toBeNull();
  });

  it('refuses a link the second time', async () => {
    const h = await start(true);
    const link = (await as(h, undefined, 'login_link_create', { email: 'a@example.com' })) as {
      url: string;
    };
    const code = link.url.split('/auth/link/')[1] as string;
    await as(h, undefined, 'auth_link_login', { code });
    const error = await rejection(as(h, undefined, 'auth_link_login', { code }));
    expect(error.message).toMatch(/already used/);
  });

  it('answers a user with 401 once disabled and an unknown actor too', async () => {
    const h = await start(true);
    await signIn(h, 'admin@example.com', true);
    const bob = await signIn(h, 'bob@example.com', false);
    await expect(as(h, bob.user.id, 'status', {})).resolves.toBeDefined();
    await as(h, undefined, 'users_disable', { email: 'bob@example.com' });
    const disabled = await rejection(as(h, bob.user.id, 'status', {}));
    expect(disabled.remoteKind).toBe('unauthorized');
    const unknown = await rejection(as(h, 'ghost', 'status', {}));
    expect(unknown.remoteKind).toBe('unauthorized');
  });

  it('refuses the administrator methods to a user without the role', async () => {
    const h = await start(true);
    await signIn(h, 'admin@example.com', true);
    const bob = await signIn(h, 'bob@example.com', false);
    const denied = [
      as(h, bob.user.id, 'users_list', {}),
      as(h, bob.user.id, 'login_link_create', { email: 'x@example.com' }),
      as(h, bob.user.id, 'repository_add', { path: h.repo }),
      as(h, bob.user.id, 'config_setting', {
        repository: h.repo,
        path: 'max',
        value: 2,
        revision: null,
        level: 'global',
      }),
      as(h, bob.user.id, 'stats_clear', { repository: h.repo }),
    ];
    for (const call of denied) {
      const error = await rejection(call);
      expect(error.remoteKind).toBe('forbidden');
      expect(error.remoteCode).toBe('access.denied');
    }
  });

  it('lets a user change the settings of a project but not the shared level', async () => {
    const h = await start(true);
    await signIn(h, 'admin@example.com', true);
    const bob = await signIn(h, 'bob@example.com', false);
    const shared = await rejection(
      as(h, bob.user.id, 'config_setting', {
        repository: h.repo,
        path: 'max',
        value: 2,
        revision: null,
        level: 'global',
      }),
    );
    expect(shared.remoteCode).toBe('access.denied');
    const project = await rejection(
      as(h, bob.user.id, 'config_setting', {
        repository: h.repo,
        path: 'max',
        value: 2,
        revision: 'stale',
        level: 'project',
      }),
    ).catch((error: unknown) => error as IpcError);
    expect((project as IpcError).remoteCode).toBeUndefined();
  });

  it('keeps tokens of a user: issue, list, use, revoke', async () => {
    const h = await start(true);
    const admin = await signIn(h, 'admin@example.com', true);
    const created = (await as(h, admin.user.id, 'tokens_create', {
      name: 'laptop',
      ttl: '30d',
    })) as {
      value: string;
    };
    expect(created.value).toMatch(/^aip_pat_/);
    const listed = (await as(h, admin.user.id, 'tokens_list', {})) as {
      tokens: { name: string }[];
    };
    expect(listed.tokens.map((token) => token.name)).toEqual(['laptop']);
    const resolved = (await as(h, undefined, 'auth_resolve', { token: created.value })) as {
      user: { email: string } | null;
    };
    expect(resolved.user?.email).toBe('admin@example.com');
    await as(h, admin.user.id, 'tokens_revoke', { token: 'laptop' });
    const after = (await as(h, undefined, 'auth_resolve', { token: created.value })) as {
      user: unknown;
    };
    expect(after.user).toBeNull();
    const tooLong = await rejection(
      as(h, admin.user.id, 'tokens_create', { name: 'long', ttl: '365d' }),
    );
    expect(tooLong.message).toMatch(/90d/);
  });
});

describe('repository_match', () => {
  it('finds the project by the normalised origin', async () => {
    const h = await start(false);
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], {
      cwd: h.repo,
    });
    await h.call('repository_add', { path: h.repo });
    const found = (await h.call('repository_match', {
      remotes: ['git@github.com:acme/app.git'],
    })) as { project: { path: string } | null };
    expect(found.project?.path).toBe(h.repo);
    const none = (await h.call('repository_match', {
      remotes: ['git@github.com:acme/other.git'],
    })) as { project: unknown };
    expect(none.project).toBeNull();
  });
});
