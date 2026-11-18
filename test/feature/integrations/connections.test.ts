import { describe, expect, it } from 'vitest';

import { exampleAdapter, fixture, SENTINEL } from './helpers.ts';

describe('catalog', () => {
  it('is empty without built-in adapters and refuses every kind', async () => {
    const f = fixture({ adapters: [] });
    expect(f.services.connections.types()).toEqual([]);
    await expect(
      f.services.connections.add({ kind: 'unknown', name: 'main', global: true }),
    ).rejects.toThrow(/unknown integration kind/);
    expect(await f.services.connections.list()).toEqual([]);
    expect(f.store.calls).toEqual([]);
  });

  it('lists the declared parameters, secrets and directions of a built-in kind', () => {
    const [entry] = fixture().services.connections.types();
    expect(entry).toMatchObject({
      kind: 'example',
      directions: ['inbound', 'outbound'],
      secrets: [
        { slot: 'token', required: true },
        { slot: 'signing', required: false },
      ],
    });
  });

  it('refuses a kind registered twice', () => {
    expect(() => fixture({ adapters: [exampleAdapter(), exampleAdapter()] })).toThrow(/twice/);
  });
});

describe('named connections', () => {
  it('keeps two accounts of one kind in one project apart', async () => {
    const f = fixture();
    const { connections } = f.services;
    const main = await connections.add({
      kind: 'example',
      name: 'main',
      repository: 'app',
      params: { account: 'one' },
    });
    const backup = await connections.add({
      kind: 'example',
      name: 'backup',
      repository: '/work/app',
      params: { account: 'two' },
    });
    expect(main.id).not.toBe(backup.id);
    await connections.setSecret(main.id, 'token', 'first-value');
    await connections.setSecret(backup.id, 'token', 'second-value');
    const listed = await connections.list('app');
    expect(listed.map((one) => [one.name, one.params.account, one.project])).toEqual([
      ['main', 'one', '/work/app'],
      ['backup', 'two', '/work/app'],
    ]);
    expect(await connections.list('lib')).toEqual([]);
    expect(await f.services.secrets.read(main.id, 'token')).toBe('first-value');
    expect(await f.services.secrets.read(backup.id, 'token')).toBe('second-value');
  });

  it('refuses a duplicate name, an unregistered project and a missing or double scope', async () => {
    const { connections } = fixture().services;
    await connections.add({ kind: 'example', name: 'main', repository: 'app' });
    await expect(
      connections.add({ kind: 'example', name: 'main', repository: 'app' }),
    ).rejects.toThrow(/already exists/);
    await connections.add({ kind: 'example', name: 'main', repository: 'lib' });
    await expect(
      connections.add({ kind: 'example', name: 'main', repository: '/nowhere' }),
    ).rejects.toThrow(/not registered/);
    await expect(connections.add({ kind: 'example', name: 'main' })).rejects.toThrow(/explicitly/);
    await expect(
      connections.add({ kind: 'example', name: 'main', repository: 'app', global: true }),
    ).rejects.toThrow(/explicitly/);
    await expect(
      connections.add({ kind: 'example', name: 'bad name', repository: 'app' }),
    ).rejects.toThrow(/name/);
    await expect(
      connections.add({
        kind: 'example',
        name: 'x',
        repository: 'app',
        params: { region: 'mars' },
      }),
    ).rejects.toThrow(/region/);
  });

  it('shows a shared connection in every project and only when it was chosen explicitly', async () => {
    const f = fixture();
    const { connections } = f.services;
    const shared = await connections.add({ kind: 'example', name: 'org', global: true });
    expect(shared).toMatchObject({ scope: 'global', project: null });
    expect((await connections.list('app')).map((one) => one.id)).toEqual([shared.id]);
    expect((await connections.list('lib')).map((one) => one.id)).toEqual([shared.id]);
  });

  it('refuses a connection of another project before any secret is read', async () => {
    const f = fixture();
    const { connections } = f.services;
    const own = await connections.add({ kind: 'example', name: 'main', repository: 'app' });
    await connections.setSecret(own.id, 'token', 'value');
    await connections.enable(own.id);
    f.store.calls.length = 0;
    expect(() => f.services.access.authorize(own.id, '/work/lib')).toThrow(/does not apply/);
    expect(f.services.access.authorize(own.id, '/work/app').id).toBe(own.id);
    expect(f.store.calls).toEqual([]);
  });

  it('keeps the list and the secret after a restart, without values in the answer', async () => {
    const f = fixture();
    const created = await f.services.connections.add({
      kind: 'example',
      name: 'main',
      repository: 'app',
    });
    await f.services.connections.setSecret(created.id, 'token', SENTINEL);
    const again = f.restart();
    const [view] = await again.connections.list();
    expect(view).toMatchObject({
      id: created.id,
      secrets: [
        { slot: 'token', required: true, present: true },
        { slot: 'signing', required: false, present: false },
      ],
    });
    expect(JSON.stringify(view)).not.toContain(SENTINEL);
    expect(await again.secrets.read(created.id, 'token')).toBe(SENTINEL);
  });

  it('keeps the connection of a kind the build no longer knows, without authority', async () => {
    const f = fixture();
    const created = await f.services.connections.add({
      kind: 'example',
      name: 'main',
      global: true,
    });
    await f.services.connections.setSecret(created.id, 'token', 'v');
    const without = f.restart({ adapters: [] });
    const [view] = await without.connections.list();
    expect(view?.secrets).toEqual([{ slot: 'token', required: false, present: true }]);
    await expect(without.connections.enable(created.id)).rejects.toThrow(
      /unknown integration kind/,
    );
  });
});
