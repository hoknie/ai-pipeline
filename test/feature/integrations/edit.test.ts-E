import { describe, expect, it } from 'vitest';

import type { ConnectionChange } from '../../../src/feature/integrations/ports/index.ts';
import type { AdapterDescriptor } from '../../../src/feature/integrations/types/index.ts';

import { SENTINEL, exampleAdapter, fixture } from './helpers.ts';

const BOT: AdapterDescriptor = {
  kind: 'bot',
  title: 'Bot',
  params: [
    { name: 'chat_id', required: false, maxLength: 20, pattern: '-?[0-9]+' },
    { name: 'users', required: true, maxLength: 100, pattern: '[1-9][0-9]*(,[1-9][0-9]*)*' },
    { name: 'workspace', required: false, maxLength: 20, immutable: true },
  ],
  secrets: [{ slot: 'bot_token', required: true }],
  directions: ['inbound'],
  operations: [],
};

function setup() {
  const changes: [string, ConnectionChange][] = [];
  const base = fixture({
    adapters: [{ descriptor: BOT }, exampleAdapter()],
    overrides: { changes: { connectionChanged: (id, change) => void changes.push([id, change]) } },
  });
  return { ...base, changes, connections: base.services.connections };
}

async function bot(
  base: ReturnType<typeof setup>,
  params: Record<string, string> = { users: '1' },
) {
  const added = await base.connections.add({ kind: 'bot', name: 'main', global: true, params });
  await base.connections.setSecret(added.id, 'bot_token', 'tok');
  return added.id;
}

describe('editing the parameters of a connection', () => {
  it('sets a parameter a connection lacks and keeps id and secret', async () => {
    const base = setup();
    const id = await bot(base);
    const edited = await base.connections.edit(id, { set: { chat_id: '-1001234567890' } });
    expect(edited).toMatchObject({
      id,
      params: { users: '1', chat_id: '-1001234567890' },
      enabled: false,
      secrets: [{ slot: 'bot_token', present: true }],
    });
    expect((await base.connections.list()).find((one) => one.id === id)?.params.chat_id).toBe(
      '-1001234567890',
    );
  });

  it('unsets an optional parameter and refuses to unset a required one', async () => {
    const base = setup();
    const id = await bot(base, { users: '1', chat_id: '5' });
    const edited = await base.connections.edit(id, { unset: ['chat_id'] });
    expect(edited.params).toEqual({ users: '1' });
    await expect(base.connections.edit(id, { unset: ['users'] })).rejects.toThrow(/: users/);
    expect((await base.connections.list())[0]?.params).toEqual({ users: '1' });
  });

  it('checks the result as a whole and names the parameter, never the value', async () => {
    const base = setup();
    const id = await bot(base);
    const error = await base.connections
      .edit(id, { set: { users: `abc${SENTINEL}` } })
      .catch((thrown: Error) => thrown);
    expect((error as Error).message).toContain('users');
    expect((error as Error).message).not.toContain(SENTINEL);
    expect((await base.connections.list())[0]?.params).toEqual({ users: '1' });
    await expect(base.connections.edit(id, { set: { nothing: '1' } })).rejects.toThrow(
      /invalid connection parameters/,
    );
  });

  it('refuses an empty change and a parameter set and unset together', async () => {
    const base = setup();
    const id = await bot(base);
    await expect(base.connections.edit(id, {})).rejects.toThrow(/nothing to change/);
    await expect(
      base.connections.edit(id, { set: { chat_id: '1' }, unset: ['chat_id'] }),
    ).rejects.toThrow(/both set and unset/);
  });

  it('refuses a parameter the kind declares immutable', async () => {
    const base = setup();
    const id = await bot(base, { users: '1', workspace: 'acme' });
    await expect(base.connections.edit(id, { set: { workspace: 'other' } })).rejects.toThrow(
      /cannot be changed.*workspace/,
    );
    await expect(base.connections.edit(id, { unset: ['workspace'] })).rejects.toThrow(
      /cannot be changed/,
    );
    expect((await base.connections.list())[0]?.params.workspace).toBe('acme');
  });

  it('refuses a secret slot as a parameter without echoing the value', async () => {
    const base = setup();
    const id = await bot(base);
    const error = await base.connections
      .edit(id, { set: { bot_token: SENTINEL } })
      .catch((thrown: Error) => thrown);
    expect((error as Error).message).toContain('bot_token');
    expect((error as Error).message).not.toContain(SENTINEL);
    expect(base.store.values.size).toBe(1);
  });

  it('keeps an enabled connection enabled and tells the listeners', async () => {
    const base = setup();
    const id = await bot(base);
    await base.connections.enable(id);
    base.changes.length = 0;
    const edited = await base.connections.edit(id, { set: { chat_id: '7' } });
    expect(edited.enabled).toBe(true);
    expect(base.changes).toEqual([[id, 'params']]);
  });

  it('refuses a connection that waits for its cleanup and an unknown one', async () => {
    const base = setup();
    const id = await bot(base);
    await expect(base.connections.edit('nope', { set: { chat_id: '1' } })).rejects.toThrow(
      /not found/,
    );
    base.store.failNext.add('delete');
    await base.connections.remove(id).catch(() => undefined);
    await expect(base.connections.edit(id, { set: { chat_id: '1' } })).rejects.toThrow(
      /cleanup is not finished/,
    );
  });

  it('tells the listeners about enabling, secrets, disabling and removal', async () => {
    const base = setup();
    const added = await base.connections.add({
      kind: 'bot',
      name: 'x',
      global: true,
      params: { users: '1' },
    });
    await base.connections.setSecret(added.id, 'bot_token', 'tok');
    await base.connections.enable(added.id);
    base.connections.disable(added.id);
    await base.connections.removeSecret(added.id, 'bot_token');
    await base.connections.remove(added.id);
    expect(base.changes.map(([, change]) => change)).toEqual([
      'secret',
      'enabled',
      'disabled',
      'secret',
      'removed',
    ]);
  });

  it('is not hurt by a listener that throws', async () => {
    const base = fixture({
      adapters: [{ descriptor: BOT }],
      overrides: {
        changes: {
          connectionChanged: () => {
            throw new Error('boom');
          },
        },
      },
    });
    const added = await base.services.connections.add({
      kind: 'bot',
      name: 'x',
      global: true,
      params: { users: '1' },
    });
    await expect(
      base.services.connections.edit(added.id, { set: { chat_id: '1' } }),
    ).resolves.toMatchObject({ params: { chat_id: '1' } });
  });
});
