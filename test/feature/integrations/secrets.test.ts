import { describe, expect, it } from 'vitest';

import type { SecretStep } from '../../../src/feature/integrations/services/index.ts';

import { MemoryStore, SENTINEL, fixture, type Fixture } from './helpers.ts';

/** Throws, as a crash would, at the `occurrence`-th time the step is reached. */
function crashAt(step: SecretStep, occurrence = 1): (reached: SecretStep) => void {
  let seen = 0;
  return (reached) => {
    if (reached === step && ++seen === occurrence) throw new Error('crash');
  };
}

async function connected(f: Fixture, value = 'old-value') {
  const created = await f.services.connections.add({
    kind: 'example',
    name: 'main',
    repository: 'app',
  });
  await f.services.connections.setSecret(created.id, 'token', value);
  return created.id;
}

const keysOf = (store: MemoryStore): string[] => [...store.values.keys()];

describe('setting and replacing a secret', () => {
  it('writes a new generation, switches to it and deletes the old key', async () => {
    const f = fixture();
    const id = await connected(f);
    expect(keysOf(f.store)).toHaveLength(1);
    const [first] = keysOf(f.store);
    await f.services.connections.setSecret(id, 'token', 'new-value');
    expect(keysOf(f.store)).toHaveLength(1);
    expect(keysOf(f.store)[0]).not.toBe(first);
    expect(await f.services.secrets.read(id, 'token')).toBe('new-value');
    expect(f.services.secrets.pending((await f.services.connections.list())[0] as never)).toBe(
      false,
    );
  });

  it('refuses an unknown slot, an empty value and a removed connection', async () => {
    const f = fixture();
    const id = await connected(f);
    await expect(f.services.connections.setSecret(id, 'other', 'v')).rejects.toThrow(/slot/);
    await expect(f.services.connections.setSecret(id, 'token', '')).rejects.toThrow(/empty/);
    await expect(f.services.connections.setSecret('nope', 'token', 'v')).rejects.toThrow(
      /not found/,
    );
  });

  it.each([
    ['intent', 'old-value'],
    ['written', 'old-value'],
    ['switched', 'new-value'],
    ['erased', 'new-value'],
  ] as const)('recovers a replacement cut short after %s', async (step, expected) => {
    const f = fixture();
    const id = await connected(f);
    const crashing = f.restart({ secretStep: crashAt(step) });
    await expect(crashing.connections.setSecret(id, 'token', 'new-value')).rejects.toThrow('crash');
    // The stop leaves the connection without authority until the recovery has run.
    const restarted = f.restart();
    await restarted.connections.enable(id).catch(() => undefined);
    expect(() => restarted.access.authorize(id, '/work/app')).toThrow(/disabled/);
    expect(await restarted.secrets.recover()).toEqual({ failed: 0 });
    expect(await restarted.secrets.read(id, 'token')).toBe(expected);
    // Only the inactive generation was removed.
    expect(keysOf(f.store)).toHaveLength(1);
    expect([...f.store.values.values()]).toEqual([expected]);
    expect(await restarted.secrets.recover()).toEqual({ failed: 0 });
    expect(await restarted.secrets.read(id, 'token')).toBe(expected);
    await restarted.connections.enable(id);
  });

  it.each(['intent', 'written', 'switched'] as const)(
    'recovers a first value cut short after %s',
    async (step) => {
      const f = fixture();
      const { id } = await f.services.connections.add({
        kind: 'example',
        name: 'main',
        repository: 'app',
      });
      const crashing = f.restart({ secretStep: crashAt(step) });
      await expect(crashing.connections.setSecret(id, 'token', 'first')).rejects.toThrow('crash');
      const restarted = f.restart();
      await restarted.secrets.recover();
      if (step === 'switched') expect(await restarted.secrets.read(id, 'token')).toBe('first');
      else {
        expect(restarted.secrets.has(id, 'token')).toBe(false);
        expect(keysOf(f.store)).toEqual([]);
      }
    },
  );

  it('keeps the old value when the store fails, and no orphan once it answers again', async () => {
    const f = fixture();
    const id = await connected(f);
    f.store.failNext.add('put');
    await expect(f.services.connections.setSecret(id, 'token', 'new-value')).rejects.toThrow(
      /secret storage failed/,
    );
    expect(await f.services.secrets.read(id, 'token')).toBe('old-value');
    expect(keysOf(f.store)).toHaveLength(1);
  });

  it('keeps the intent and blocks the connection while the store is down', async () => {
    const f = fixture();
    const id = await connected(f);
    await f.services.connections.enable(id);
    f.store.down = true;
    await expect(f.services.connections.setSecret(id, 'token', 'new-value')).rejects.toThrow(
      /unavailable/,
    );
    f.store.down = false;
    // The check failed before anything was written: nothing is pending.
    expect(f.services.access.authorize(id, '/work/app').id).toBe(id);
    // A put that fails and whose cleanup fails too leaves the intent.
    f.store.failNext.add('put');
    const stuck = f.restart();
    const original = f.store.delete.bind(f.store);
    f.store.delete = () => Promise.reject(new Error(SENTINEL));
    await expect(stuck.connections.setSecret(id, 'token', 'newer')).rejects.toThrow();
    f.store.delete = original;
    expect(() => stuck.access.authorize(id, '/work/app')).toThrow(/disabled/);
    expect(await stuck.secrets.recover()).toEqual({ failed: 0 });
    expect(await stuck.secrets.read(id, 'token')).toBe('old-value');
    expect(stuck.access.authorize(id, '/work/app').id).toBe(id);
  });

  it('serializes two replacements of one connection', async () => {
    const f = fixture();
    const id = await connected(f);
    await Promise.all([
      f.services.connections.setSecret(id, 'token', 'a'),
      f.services.connections.setSecret(id, 'token', 'b'),
    ]);
    expect(await f.services.secrets.read(id, 'token')).toBe('b');
    expect(keysOf(f.store)).toHaveLength(1);
  });

  it('never puts the value or the text of the store into an error', async () => {
    const f = fixture();
    const id = await connected(f);
    f.store.failNext.add('put');
    const error = await f.services.connections
      .setSecret(id, 'token', SENTINEL)
      .catch((caught: Error) => caught);
    expect(String((error as Error).message)).not.toContain(SENTINEL);
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
  });
});

describe('removing a secret', () => {
  it('switches the connection off before the store is touched and does not switch it back on', async () => {
    const f = fixture();
    const id = await connected(f);
    await f.services.connections.enable(id);
    f.store.down = true;
    await expect(f.services.connections.removeSecret(id, 'token')).rejects.toThrow();
    const [view] = await f.services.connections.list();
    expect(view).toMatchObject({ enabled: false, pending: true });
    expect(view?.secrets[0]).toMatchObject({ slot: 'token', present: true });
    await expect(f.services.connections.enable(id)).rejects.toThrow(/not finished/);
    f.store.down = false;
    await f.services.secrets.recover();
    expect(keysOf(f.store)).toEqual([]);
    const [after] = await f.services.connections.list();
    expect(after).toMatchObject({ enabled: false, pending: false });
    expect(after?.secrets[0]).toMatchObject({ present: false });
    await expect(f.services.connections.enable(id)).rejects.toThrow(/token/);
    await f.services.connections.setSecret(id, 'token', 'again');
    expect((await f.services.connections.enable(id)).enabled).toBe(true);
  });

  it.each(['intent', 'erased'] as const)('finishes a removal cut short after %s', async (step) => {
    const f = fixture();
    const id = await connected(f);
    const crashing = f.restart({ secretStep: crashAt(step) });
    await expect(crashing.connections.removeSecret(id, 'token')).rejects.toThrow('crash');
    const restarted = f.restart();
    await restarted.secrets.recover();
    await restarted.secrets.recover();
    expect(restarted.secrets.has(id, 'token')).toBe(false);
    expect(keysOf(f.store)).toEqual([]);
  });

  it('refuses a slot with no secret', async () => {
    const f = fixture();
    const { id } = await f.services.connections.add({
      kind: 'example',
      name: 'main',
      repository: 'app',
    });
    await expect(f.services.connections.removeSecret(id, 'token')).rejects.toThrow(
      /no such secret/,
    );
  });
});

describe('removing a connection', () => {
  it('deletes the secrets by their generations and then the rows', async () => {
    const f = fixture();
    const id = await connected(f);
    await f.services.connections.setSecret(id, 'signing', 'other');
    await f.services.connections.remove(id);
    expect(keysOf(f.store)).toEqual([]);
    expect(await f.services.connections.list()).toEqual([]);
    expect(f.database.prepare('SELECT * FROM integration_secret_slots').all()).toEqual([]);
  });

  it('leaves a tombstone without authority when the store fails, and finishes on retry', async () => {
    const f = fixture();
    const id = await connected(f);
    await f.services.connections.enable(id);
    f.store.down = true;
    await expect(f.services.connections.remove(id)).rejects.toThrow(/cleanup is not finished/);
    const [view] = await f.services.connections.list();
    expect(view).toMatchObject({ state: 'cleanup_pending', enabled: false, pending: true });
    expect(() => f.services.access.authorize(id, '/work/app')).toThrow(/disabled/);
    await expect(f.services.connections.setSecret(id, 'token', 'v')).rejects.toThrow();
    await expect(f.services.connections.enable(id)).rejects.toThrow();
    // A restart with the store still down keeps the tombstone.
    const restarted = f.restart();
    expect(await restarted.secrets.recover()).toEqual({ failed: 1 });
    expect(await restarted.connections.list()).toHaveLength(1);
    f.store.down = false;
    await restarted.connections.remove(id);
    expect(await restarted.connections.list()).toEqual([]);
    expect(keysOf(f.store)).toEqual([]);
  });

  it.each(['intent', 'erased'] as const)('finishes a removal cut short after %s', async (step) => {
    const f = fixture();
    const id = await connected(f);
    const crashing = f.restart({ secretStep: crashAt(step) });
    await expect(crashing.connections.remove(id)).rejects.toThrow('crash');
    const restarted = f.restart();
    expect(await restarted.secrets.recover()).toEqual({ failed: 0 });
    expect(await restarted.connections.list()).toEqual([]);
    expect(keysOf(f.store)).toEqual([]);
  });

  it('also removes the active value of a replacement that a crash left half done', async () => {
    const f = fixture();
    const id = await connected(f);
    const crashing = f.restart({ secretStep: crashAt('written') });
    await expect(crashing.connections.setSecret(id, 'token', 'new')).rejects.toThrow('crash');
    await f.restart().connections.remove(id);
    expect(keysOf(f.store)).toEqual([]);
  });
});
