import { afterEach, describe, expect, it } from 'vitest';

import { asking, chatConnection, harness, type Harness } from './helpers.ts';

let current: Harness | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

const QUESTIONS = [{ text: 'Which database?', options: ['SQLite', 'PostgreSQL'] }];

function setup() {
  const h = harness();
  current = h;
  return h;
}

/** The connection services told the channels; wait until they have dealt with it. */
const settle = (h: Harness) => h.notifications.channels.settled();

describe('the listeners of the channels', () => {
  it('starts a listener for an enabled connection with its secret, whatever the subscriptions', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    expect(h.channels.of(id).listens).toBe(1);
    expect(h.notifications.channels.statusOf(id)).toEqual({ state: 'listening' });
    expect(h.published).toContain(`channel:${id}:listening`);
  });

  it('starts none for a disabled connection and none while a required secret is missing', async () => {
    const h = setup();
    const off = await chatConnection(h.base, { name: 'off', enabled: false });
    const bare = await h.base.services.connections.add({
      kind: 'chat',
      name: 'bare',
      global: true,
    });
    await settle(h);
    expect(h.channels.of(off).listens).toBe(0);
    expect(h.channels.of(bare.id).listens).toBe(0);
    await h.base.services.connections.setSecret(bare.id, 'token', 'x');
    await h.base.services.connections.enable(bare.id);
    await settle(h);
    expect(h.channels.of(bare.id).listens).toBe(1);
  });

  it('starts the listeners of the connections that are enabled when the daemon starts', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    const again = h.restart();
    await again.channels.start();
    expect(h.channels.of(id).listens).toBe(2);
  });

  it('stops the listener when the connection is disabled or its secret removed', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    h.base.services.connections.disable(id);
    await settle(h);
    expect(h.channels.of(id).aborted).toBe(1);
    expect(h.notifications.channels.statusOf(id)).toBeNull();
    await h.base.services.connections.enable(id);
    await settle(h);
    expect(h.channels.of(id).listens).toBe(2);
    await h.base.services.connections.removeSecret(id, 'token');
    await settle(h);
    expect(h.channels.of(id).aborted).toBe(2);
    expect(h.channels.of(id).listens).toBe(2);
  });

  it('starts the listener again when the secret is replaced', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    await h.base.services.connections.setSecret(id, 'token', 'new');
    await settle(h);
    expect(h.channels.of(id).listens).toBe(2);
    expect(h.channels.of(id).aborted).toBe(1);
  });

  it('does not ask a channel with rejected credentials again until the secret is replaced', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    h.channels.of(id).status = { state: 'error', error: 'unauthorized', unauthorized: true };
    await h.base.services.connections.setSecret(id, 'token', 'wrong');
    await settle(h);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.channels.of(id).listens).toBe(2);
    expect(h.notifications.channels.statusOf(id)).toMatchObject({
      state: 'error',
      unauthorized: true,
    });
    h.channels.of(id).status = { state: 'listening' };
    await h.base.services.connections.setSecret(id, 'token', 'right');
    await settle(h);
    expect(h.channels.of(id).listens).toBe(3);
    expect(h.notifications.channels.statusOf(id)).toEqual({ state: 'listening' });
  });

  it('starts the listener again after a change of the language', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    h.channels.of(id).status = { state: 'error', error: 'network', unauthorized: false };
    // Make the running listener end the way a failing channel does.
    await h.base.services.connections.edit(id, { set: { language: 'ru' } });
    await settle(h);
    expect(h.channels.of(id).listens).toBe(2);
  });

  it('stops every listener when the daemon stops', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    await h.notifications.channels.stop();
    expect(h.channels.of(id).aborted).toBe(1);
  });
});

describe('changing the parameters of an enabled connection', () => {
  it('restarts the listener with the new parameters and keeps the read position', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await settle(h);
    const first = h.channels.built.at(-1)!;
    first.options.cursor.set('42');
    await h.base.services.connections.edit(id, { set: { allowed_users: '1,2' } });
    await settle(h);
    expect(h.channels.of(id).aborted).toBe(1);
    expect(h.channels.of(id).listens).toBe(2);
    const second = h.channels.built.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.options.connection.params.allowed_users).toBe('1,2');
    expect(second.options.cursor.get()).toBe('42');
    const view = (await h.base.services.connections.list()).find((one) => one.id === id);
    expect(view?.enabled).toBe(true);
  });

  it('sends a new message to the new chat and closes the old one in the old chat', async () => {
    const h = setup();
    const id = await chatConnection(h.base, { params: { chat_id: '-100' } });
    await h.notifications.subscriptions.add({ connection: id, repository: 'app' });
    const state = asking(QUESTIONS);
    await h.save(state);
    const script = h.channels.of(id);
    expect(script.sent[0]?.ref.chat_id).toBe('-100');
    await h.base.services.connections.edit(id, { set: { chat_id: '-200' } });
    await settle(h);
    // A new question goes to the new chat.
    await h.save(asking(QUESTIONS, { id: 'run000000002' }));
    expect(script.sent.map((one) => one.ref.chat_id)).toEqual(['-100', '-200']);
    // The first one is answered in the panel: it is closed where it was sent.
    const asked = state.groups[0]!;
    asked.decisions.push({ stepId: 'plan', question: '', answer: 'x', by: 'human' });
    asked.status = 'queued';
    asked.question = null;
    asked.questions = null;
    await h.save(state);
    expect(script.updates.at(-1)).toMatchObject({ ref: { chat_id: '-100' } });
    expect(script.updates.at(-1)?.message.state).toBe('closed');
  });

  it('waits for the chat without failing: the subscription stays, the delivery fails with a reason', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await h.notifications.subscriptions.add({ connection: id, repository: 'app' });
    await h.base.services.connections.edit(id, { unset: ['chat_id'] });
    await settle(h);
    expect(h.channels.of(id).listens).toBe(2);
    await h.save(asking(QUESTIONS));
    expect(h.notifications.journal.list({ state: 'failed' })).toMatchObject([
      { error: 'chat_id is not set' },
    ]);
    expect((await h.notifications.subscriptions.list())[0]?.enabled).toBe(true);
  });
});

describe('removing a connection', () => {
  it('stops its listener, drops its subscriptions and forgets the read position', async () => {
    const h = setup();
    const id = await chatConnection(h.base);
    await h.notifications.subscriptions.add({ connection: id, repository: 'app' });
    await settle(h);
    h.channels.built.at(-1)!.options.cursor.set('7');
    await h.base.services.connections.remove(id);
    await settle(h);
    expect(h.channels.of(id).aborted).toBe(1);
    expect(await h.notifications.subscriptions.list()).toEqual([]);
    expect(h.published).toContain('subscriptions');
  });
});
