import { describe, expect, it } from 'vitest';

import { createIdentityServices } from '../../../src/feature/identity/services/index.ts';
import { pkceChallenge } from '../../../src/feature/identity/services/system.ts';
import { Database } from '../../../src/platform/sqlite/index.ts';
import { defaultServer } from '../../../src/feature/swarm-config/types/index.ts';

function setup(settings = defaultServer()) {
  let time = 1_000_000;
  let counter = 0;
  const clock = { now: () => time };
  const random = {
    token: (size: number) => {
      counter += 1;
      return `${counter}`.padStart(size === 32 ? 43 : size, 'x').replaceAll('+', '-');
    },
    id: () => `id-${(counter += 1)}`,
  };
  const services = createIdentityServices({
    database: new Database(':memory:'),
    settings: () => settings,
    clock,
    random,
  });
  return { services, advance: (ms: number) => (time += ms) };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('users and login links', () => {
  it('create the first administrator by a link and a session', () => {
    const { services } = setup();
    const { code } = services.sessions.createLink({ email: 'Admin@Example.com', admin: true });
    const login = services.sessions.loginByLink(code);
    expect(login.user.attributes).toEqual({ role: ['admin'] });
    expect(services.sessions.resolve(login.session)?.email).toBe('Admin@Example.com');
  });

  it('use a link once', () => {
    const { services } = setup();
    const { code } = services.sessions.createLink({ email: 'a@example.com' });
    services.sessions.loginByLink(code);
    expect(() => services.sessions.loginByLink(code)).toThrow(/already used/);
  });

  it('refuse an expired link and an unknown one', () => {
    const { services, advance } = setup();
    const { code } = services.sessions.createLink({ email: 'a@example.com', ttl: '15m' });
    advance(16 * 60_000);
    expect(() => services.sessions.loginByLink(code)).toThrow(/expired/);
    expect(() => services.sessions.loginByLink('nope')).toThrow(/not valid/);
  });

  it('limit the lifetime of a link to 7 days', () => {
    const { services } = setup();
    expect(() => services.sessions.createLink({ email: 'a@example.com', ttl: '8d' })).toThrow(
      /7 days/,
    );
  });

  it('keep one user for emails that differ by case', () => {
    const { services } = setup();
    services.sessions.loginByLink(
      services.sessions.createLink({ email: 'alice@example.com' }).code,
    );
    services.sessions.loginByLink(
      services.sessions.createLink({ email: 'Alice@Example.com' }).code,
    );
    expect(services.users.list()).toHaveLength(1);
  });

  it('refuse a link of a disabled user', () => {
    const { services } = setup();
    services.users.ensure('root@example.com', null, true);
    services.users.ensure('bob@example.com', null, false);
    services.users.disable('bob@example.com');
    const { code } = services.sessions.createLink({ email: 'bob@example.com' });
    expect(() => services.sessions.loginByLink(code)).toThrow(/disabled/);
  });

  it('end a session by its lifetime and by logout', () => {
    const { services, advance } = setup({ ...defaultServer(), sessionTtl: '12h' });
    const first = services.sessions.loginByLink(
      services.sessions.createLink({ email: 'a@example.com' }).code,
    );
    advance(13 * HOUR);
    expect(services.sessions.resolve(first.session)).toBeNull();
    const second = services.sessions.loginByLink(
      services.sessions.createLink({ email: 'a@example.com' }).code,
    );
    expect(services.sessions.resolve(second.session)).not.toBeNull();
    services.sessions.logout(second.session);
    expect(services.sessions.resolve(second.session)).toBeNull();
  });

  it('never leave no active administrator', () => {
    const { services } = setup();
    services.users.ensure('root@example.com', null, true);
    expect(() => services.users.disable('root@example.com')).toThrow(/no active administrator/);
    expect(() => services.users.setAttributes('root@example.com', { role: [] })).toThrow(
      /no active administrator/,
    );
    services.users.ensure('second@example.com', null, true);
    expect(services.users.disable('root@example.com').disabled).toBe(true);
  });

  it('change the attributes of a local user and drop an empty one', () => {
    const { services } = setup();
    services.users.ensure('a@example.com', null, false);
    expect(services.users.setAttributes('a@example.com', { team: ['x', 'y'] }).attributes).toEqual({
      team: ['x', 'y'],
    });
    expect(services.users.setAttributes('a@example.com', { team: [] }).attributes).toEqual({});
  });
});

describe('personal tokens', () => {
  it('issue, resolve, list and revoke', () => {
    const { services } = setup();
    const user = services.users.ensure('a@example.com', null, false);
    const { value, token } = services.tokens.create(user.id, 'laptop', '30d');
    expect(value.startsWith('aip_pat_')).toBe(true);
    expect(token.expiresAt - token.createdAt).toBe(30 * DAY);
    expect(services.tokens.resolve(value)?.id).toBe(user.id);
    expect(services.tokens.list(user.id)[0]?.start).toBe(value.slice(0, 12));
    services.tokens.revoke(user.id, 'laptop', false);
    expect(services.tokens.resolve(value)).toBeNull();
  });

  it('refuse a lifetime above token_max_ttl', () => {
    const { services } = setup({ ...defaultServer(), tokenMaxTtl: '90d' });
    const user = services.users.ensure('a@example.com', null, false);
    expect(() => services.tokens.create(user.id, 'x', '365d')).toThrow(/90d/);
  });

  it('refuse an expired token and the token of a disabled user', () => {
    const { services, advance } = setup();
    services.users.ensure('root@example.com', null, true);
    const user = services.users.ensure('bob@example.com', null, false);
    const short = services.tokens.create(user.id, 'short', '1d');
    advance(2 * DAY);
    expect(services.tokens.resolve(short.value)).toBeNull();
    const live = services.tokens.create(user.id, 'live', '30d');
    services.users.disable('bob@example.com');
    expect(services.tokens.resolve(live.value)).toBeNull();
  });

  it('let a user revoke only their own tokens and an administrator any', () => {
    const { services } = setup();
    const alice = services.users.ensure('alice@example.com', null, false);
    const bob = services.users.ensure('bob@example.com', null, false);
    const { token } = services.tokens.create(alice.id, 'laptop', null);
    expect(() => services.tokens.revoke(bob.id, 'laptop', false)).toThrow(/no token/);
    expect(services.tokens.revoke(bob.id, token.id, true).id).toBe(token.id);
  });
});

describe('login of the CLI', () => {
  const verifier = 'v'.repeat(43);

  it('exchange a code once for a token', () => {
    const { services } = setup();
    const user = services.users.ensure('a@example.com', null, false);
    const { code } = services.cliLogin.approve(user, pkceChallenge(verifier), 'laptop');
    const result = services.cliLogin.exchange(code, verifier);
    expect(services.tokens.resolve(result.value)?.id).toBe(user.id);
    expect(services.tokens.list(user.id)[0]?.name).toBe('cli laptop');
    expect(() => services.cliLogin.exchange(code, verifier)).toThrow(/expired or was used/);
  });

  it('refuse a wrong verifier and an expired code', () => {
    const { services, advance } = setup();
    const user = services.users.ensure('a@example.com', null, false);
    const first = services.cliLogin.approve(user, pkceChallenge(verifier), 'laptop');
    expect(() => services.cliLogin.exchange(first.code, 'w'.repeat(43))).toThrow(/verifier/);
    const second = services.cliLogin.approve(user, pkceChallenge(verifier), 'laptop');
    advance(61_000);
    expect(() => services.cliLogin.exchange(second.code, verifier)).toThrow(/expired/);
  });
});
