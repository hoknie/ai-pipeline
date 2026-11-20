import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { warnAboutUsersWithoutRole } from '../../../src/app/lifecycle.ts';
import { createAccessServices } from '../../../src/feature/access/services/index.ts';
import type { Actor, User } from '../../../src/feature/identity/types/index.ts';
import { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';

let home: string;
let clock = 1_000_000;
let logged: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'aip-access-'));
  mkdirSync(join(home, 'aip'), { recursive: true });
  clock = 1_000_000;
  logged = [];
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const entries = [
  { path: '/work/app', slug: 'app' },
  { path: '/work/billing', slug: 'billing' },
];

function service(users: Partial<User>[] = []) {
  const config = new ConfigService({ environment: { XDG_CONFIG_HOME: home } });
  const registry = {
    entries: () => entries,
    entry: (path: string) => entries.find((entry) => entry.path === path),
  };
  return createAccessServices({
    config,
    registry: registry as never,
    users: { list: () => users as User[] },
    now: () => clock,
    log: (message) => logged.push(message),
  }).access;
}

const file = (text: string, mtime?: number) => {
  const path = join(home, 'aip', 'access.yaml');
  writeFileSync(path, text);
  if (mtime !== undefined) utimesSync(path, mtime, mtime);
};

const user = (id: string, attributes: Record<string, string[]>): Actor => ({
  kind: 'user',
  user: { id, email: `${id}@example.com`, name: id },
  attributes,
});

describe('AccessService', () => {
  it('lets `local` and `system` do everything', () => {
    const access = service();
    expect(access.authorize({ kind: 'local' }, 'users.manage').effect).toBe('allow');
    expect(access.authorize({ kind: 'system' }, 'users.manage').effect).toBe('allow');
    expect(access.readableRepositories({ kind: 'system' }).all).toBe(true);
  });

  it('decides by the presets without a file, with a path or a slug as the project', () => {
    const access = service();
    const viewer = user('v', { role: ['viewer'] });
    expect(access.can(viewer, 'project.read', { repository: '/work/app' })).toBe(true);
    expect(access.can(viewer, 'queue.add', { repository: 'app' })).toBe(false);
  });

  it('lists the readable projects', () => {
    file(`presets: false
rules:
  - id: bob-reads-app
    effect: allow
    actions: [project.read]
    resource: { repository: [app] }
`);
    const readable = service().readableRepositories(user('bob', {}));
    expect(readable.all).toBe(false);
    expect(readable.has('/work/app')).toBe(true);
    expect(readable.has('/work/billing')).toBe(false);
  });

  it('names the actions and the ones only for the author', () => {
    file(`rules:
  - id: own-runs
    effect: allow
    actions: [run.cancel]
    resource: { author: self }
`);
    const { actions, conditional } = service().allowedActions(
      user('v', { role: ['viewer'] }),
      'app',
    );
    expect(actions).toContain('project.read');
    expect(actions).not.toContain('run.cancel');
    expect(conditional).toEqual(['run.cancel']);
  });

  it('reads the file again no sooner than in 10 seconds and keeps the last good version', () => {
    const access = service();
    const dev = user('d', { role: ['developer'] });
    expect(access.can(dev, 'run.cancel', { repository: 'app' })).toBe(true);
    file(`rules:\n  - id: stop\n    effect: deny\n    actions: [run.cancel]\n`, 100);
    expect(access.can(dev, 'run.cancel', { repository: 'app' })).toBe(true);
    clock += 10_000;
    expect(access.can(dev, 'run.cancel', { repository: 'app' })).toBe(false);
    file(`rules: [oops`, 200);
    clock += 10_000;
    expect(access.can(dev, 'run.cancel', { repository: 'app' })).toBe(false);
    expect(logged.join('\n')).toMatch(/keeping the previous policy/);
    expect(logged).toHaveLength(1);
  });

  it('names the users that would be refused everything', () => {
    const users: Partial<User>[] = [
      { id: '1', email: 'a@x.com', attributes: {}, disabled: false },
      { id: '2', email: 'b@x.com', attributes: { role: ['viewer'] }, disabled: false },
      { id: '3', email: 'c@x.com', attributes: {}, disabled: true },
    ];
    expect(
      service(users)
        .usersWithoutRole()
        .map((one) => one.email),
    ).toEqual(['a@x.com']);
  });
});

describe('the warning at the start', () => {
  const serverSettings = (enabled: boolean) => () => ({ enabled });

  it('names the users without a role in server mode', () => {
    const lines: string[] = [];
    warnAboutUsersWithoutRole(
      {
        config: { serverSettings: serverSettings(true) },
        access: { usersWithoutRole: () => [{ email: 'a@x.com' }] },
      } as never,
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a@x.com');
    expect(lines[0]).toContain('server.default_role');
  });

  it('is silent without such users and in the local mode', () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const none = { usersWithoutRole: () => [] };
    const some = { usersWithoutRole: () => [{ email: 'a@x.com' }] };
    warnAboutUsersWithoutRole(
      { config: { serverSettings: serverSettings(true) }, access: none } as never,
      log,
    );
    warnAboutUsersWithoutRole(
      { config: { serverSettings: serverSettings(false) }, access: some } as never,
      log,
    );
    expect(lines).toEqual([]);
  });
});
