import { afterEach, describe, expect, it } from 'vitest';

import { notificationFailureCode } from '../../../src/feature/notifications/types/index.ts';
import { startReceiver, type FakeReceiver } from '../../fakes/webhook-receiver.ts';

import { asking, chatConnection, harness, type Harness } from './helpers.ts';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const HOUR = 3_600_000;
const QUESTIONS = [{ text: 'Which database?', options: ['SQLite', 'PostgreSQL'] }];

let current: Harness | null = null;
const receivers: FakeReceiver[] = [];
afterEach(async () => {
  await current?.close();
  current = null;
  for (const one of receivers.splice(0)) await one.close();
});

async function receiver(): Promise<FakeReceiver> {
  const one = await startReceiver();
  receivers.push(one);
  return one;
}

/** A harness with an enabled webhook of all projects towards a local receiver. */
async function hooked(options: { enable?: boolean; events?: string[] } = {}) {
  const hook = await receiver();
  const h = harness();
  current = h;
  const view = await h.notifications.webhooks.add({
    name: 'ci',
    url: `${hook.base}/hook?token=abc`,
    allProjects: true,
    ...(options.events === undefined ? {} : { events: options.events }),
  });
  await h.base.services.connections.setSecret(view.id, 'signing_secret', SECRET);
  if (options.enable !== false) await h.base.services.connections.enable(view.id);
  return { h, hook, id: view.id };
}

const failureOf = async (work: Promise<unknown>) =>
  notificationFailureCode(
    await work.then(
      () => null,
      (error: unknown) => error,
    ),
  );

/** Moves the clock and sends what is due. */
async function after(h: Harness, ms: number): Promise<void> {
  h.clock.time += ms;
  await h.notifications.dispatcher.flush();
}

describe('webhook add', () => {
  it('makes the connection and its only subscription, without a secret and switched off', async () => {
    const hook = await receiver();
    const h = harness();
    current = h;
    const view = await h.notifications.webhooks.add({
      name: 'ci',
      url: `${hook.base}/hook?token=abc`,
      allProjects: true,
    });
    expect(view).toMatchObject({
      name: 'ci',
      url: `${hook.base}/hook`,
      enabled: false,
      secret: false,
      failureStreak: 0,
    });
    expect(JSON.stringify(view)).not.toContain('token=abc');
    expect(view.events.length).toBeGreaterThan(0);
    expect(await h.notifications.subscriptions.list()).toEqual([]);
    expect(await h.notifications.webhooks.list()).toHaveLength(1);
    const connection = h.base.services.access.find(view.id);
    expect(connection.enabled).toBe(false);
    expect(connection.params.url).toBe(`${hook.base}/hook?token=abc`);
  });

  it('needs one scope and known events', async () => {
    const h = harness();
    current = h;
    const base = { name: 'ci', url: 'https://ci.example.com/hook' };
    expect(await failureOf(h.notifications.webhooks.add(base))).toBe('scope_required');
    expect(
      await failureOf(
        h.notifications.webhooks.add({ ...base, allProjects: true, repository: 'app' }),
      ),
    ).toBe('scope_required');
    expect(
      await failureOf(h.notifications.webhooks.add({ ...base, allProjects: true, events: ['x'] })),
    ).toBe('unknown_event');
    expect(await h.base.services.connections.list()).toEqual([]);
  });

  it('refuses an address that is not http(s) and names no value', async () => {
    const h = harness();
    current = h;
    await expect(
      h.notifications.webhooks.add({
        name: 'ci',
        url: 'ftp://user:pass@example.com/hook',
        allProjects: true,
      }),
    ).rejects.toThrow();
    expect(await h.base.services.connections.list()).toEqual([]);
  });

  it('leaves no connection behind when the subscription cannot be made', async () => {
    const h = harness();
    current = h;
    h.base.database.exec('DROP TABLE notification_subscriptions');
    await expect(
      h.notifications.webhooks.add({
        name: 'ci',
        url: 'https://ci.example.com/hook',
        allProjects: true,
      }),
    ).rejects.toThrow();
    expect(await h.base.services.connections.list()).toEqual([]);
  });
});

describe('webhooks and the commands of chats', () => {
  it('are refused by notify and hidden from its list and journal', async () => {
    const { h, hook, id } = await hooked();
    await h.save(asking(QUESTIONS));
    await hook.waitFor(1);
    expect(
      await failureOf(h.notifications.subscriptions.add({ connection: id, allProjects: true })),
    ).toBe('use_webhook');
    expect(await failureOf(h.notifications.dispatcher.test(id))).not.toBeNull();
    expect(await h.notifications.subscriptions.list()).toEqual([]);
    expect(await h.notifications.journal.list({})).toEqual([]);
  });

  it('are not taken for chats: a chat does not show in the webhook list', async () => {
    const { h } = await hooked();
    await chatConnection(h.base);
    expect((await h.notifications.webhooks.list()).map((one) => one.name)).toEqual(['ci']);
  });

  it('answer other kinds of connections with "not found"', async () => {
    const { h } = await hooked();
    const chat = await chatConnection(h.base, { name: 'chat' });
    expect(await failureOf(h.notifications.webhooks.enable(chat))).toBe('no_webhook');
    expect(await failureOf(h.notifications.webhooks.remove('missing'))).toBe('no_webhook');
  });
});

describe('sending to a webhook', () => {
  it('sends the question signed, once, with the id of the delivery', async () => {
    const { h, hook } = await hooked();
    const state = asking(QUESTIONS);
    await h.save(state);
    await h.save(state);
    await hook.waitFor(1);
    expect(hook.received).toHaveLength(1);
    const [seen] = hook.received;
    expect(seen?.path).toBe('/hook?token=abc');
    expect(seen?.headers['webhook-id']).toMatch(/^msg_/);
    expect(JSON.parse(seen!.body)).toMatchObject({ type: 'question.asked' });
  });

  it('retries a 503 after the first pause with the same webhook-id', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS));
    expect(hook.received).toHaveLength(1);
    await after(h, 4_000);
    expect(hook.received).toHaveLength(1);
    await after(h, 2_000);
    expect(hook.received).toHaveLength(2);
    expect(hook.received[1]?.headers['webhook-id']).toBe(hook.received[0]?.headers['webhook-id']);
    const [one] = h.notifications.webhooks.log(id, {});
    expect(one).toMatchObject({ state: 'sent', type: 'question.asked' });
    expect(one?.attempts.map((attempt) => attempt.statusCode)).toEqual([503, 200]);
  });

  it('makes eight attempts at the pauses of the schedule and then fails the delivery', async () => {
    const { h, hook, id } = await hooked();
    for (let i = 0; i < 20; i += 1) hook.answers.push({ status: 500 });
    await h.save(asking(QUESTIONS));
    const pauses = [5_000, 60_000, 600_000, HOUR, 3 * HOUR, 7 * HOUR, 11 * HOUR];
    for (const pause of pauses) await after(h, pause);
    await after(h, 24 * HOUR);
    expect(hook.received).toHaveLength(8);
    const [one] = h.notifications.webhooks.log(id, {});
    expect(one?.state).toBe('failed');
    expect(one?.attempts).toHaveLength(8);
  });

  it('waits as long as a 429 asks, no longer than the pause of the schedule', async () => {
    const { h, hook } = await hooked();
    hook.answers.push({ status: 429, headers: { 'retry-after': '1' } });
    await h.save(asking(QUESTIONS));
    await after(h, 900);
    expect(hook.received).toHaveLength(1);
    await after(h, 200);
    expect(hook.received).toHaveLength(2);
  });

  it('does not follow a redirect', async () => {
    const { h, hook, id } = await hooked();
    const other = await receiver();
    hook.answers.push({ status: 302, headers: { location: `${other.base}/x` } });
    await h.save(asking(QUESTIONS));
    expect(other.received).toHaveLength(0);
    expect(h.notifications.webhooks.log(id, {})[0]?.attempts[0]).toMatchObject({
      statusCode: 302,
      error: 'redirect',
    });
  });

  it('switches the webhook off at once after 410, with the reason', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 410 });
    await h.save(asking(QUESTIONS));
    expect(hook.received).toHaveLength(1);
    const [view] = await h.notifications.webhooks.list();
    expect(view).toMatchObject({
      enabled: false,
      disabledReason: 'the receiver answered 410 Gone',
    });
    expect(h.notifications.webhooks.log(id, {})[0]?.state).toBe('failed');
    await after(h, 100 * HOUR);
    expect(hook.received).toHaveLength(1);
  });

  it('switches the webhook off after three deliveries in a row that failed for good', async () => {
    const { h, hook, id } = await hooked();
    for (let i = 0; i < 60; i += 1) hook.answers.push({ status: 500 });
    for (const [n, name] of ['run000000001', 'run000000002', 'run000000003'].entries()) {
      await h.save(asking(QUESTIONS, { id: name }));
      expect(n).toBeLessThan(3);
    }
    for (let i = 0; i < 12; i += 1) await after(h, 12 * HOUR);
    const [view] = await h.notifications.webhooks.list();
    expect(view).toMatchObject({
      enabled: false,
      disabledReason: '3 deliveries failed in a row',
      failureStreak: 3,
    });
    expect(h.base.services.access.find(id).enabled).toBe(false);
  });

  it('counts a delivery that got through: the streak starts again', async () => {
    const { h, hook } = await hooked();
    for (let i = 0; i < 8; i += 1) hook.answers.push({ status: 500 });
    await h.save(asking(QUESTIONS, { id: 'run000000001' }));
    for (let i = 0; i < 10; i += 1) await after(h, 12 * HOUR);
    expect((await h.notifications.webhooks.list())[0]?.failureStreak).toBe(1);
    await h.save(asking(QUESTIONS, { id: 'run000000002' }));
    expect((await h.notifications.webhooks.list())[0]).toMatchObject({
      failureStreak: 0,
      enabled: true,
    });
  });

  it('goes on with a retry after a restart of the daemon', async () => {
    const { h, hook } = await hooked();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS));
    const first = hook.received[0]?.headers['webhook-id'];
    h.restart();
    await after(h, 6_000);
    expect(hook.received).toHaveLength(2);
    expect(hook.received[1]?.headers['webhook-id']).toBe(first);
  });

  it('sends the next attempt to the new address with the same webhook-id', async () => {
    const { h, hook, id } = await hooked();
    const other = await receiver();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS));
    await h.notifications.webhooks.edit(id, { url: `${other.base}/new` });
    await after(h, 6_000);
    expect(hook.received).toHaveLength(1);
    expect(other.received).toHaveLength(1);
    expect(other.received[0]?.path).toBe('/new');
    expect(other.received[0]?.headers['webhook-id']).toBe(hook.received[0]?.headers['webhook-id']);
  });
});

describe('webhook edit, enable, disable, remove', () => {
  it('edit without a change is refused', async () => {
    const { h, id } = await hooked();
    expect(await failureOf(h.notifications.webhooks.edit(id, {}))).toBe('nothing_to_edit');
  });

  it('edit --url with a wrong address changes nothing', async () => {
    const { h, hook, id } = await hooked();
    await expect(
      h.notifications.webhooks.edit(id, { url: 'ftp://example.com/x' }),
    ).rejects.toThrow();
    expect(h.base.services.access.find(id).params.url).toBe(`${hook.base}/hook?token=abc`);
  });

  it('edit --events changes the events of the only subscription', async () => {
    const { h, hook, id } = await hooked();
    const view = await h.notifications.webhooks.edit(id, { events: ['failed'] });
    expect(view.events).toEqual(['failed']);
    await h.save(asking(QUESTIONS));
    expect(hook.received).toHaveLength(0);
    expect(await failureOf(h.notifications.webhooks.edit(id, { events: ['nope'] }))).toBe(
      'unknown_event',
    );
  });

  it('enable after an automatic switch-off forgets the reason and the streak', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 410 });
    await h.save(asking(QUESTIONS));
    expect((await h.notifications.webhooks.list())[0]?.disabledReason).not.toBeNull();
    await h.base.services.connections.enable(id);
    expect((await h.notifications.webhooks.list())[0]).toMatchObject({
      enabled: true,
      disabledReason: null,
      failureStreak: 0,
    });
    // what happened while it was off is not sent
    await h.notifications.dispatcher.flush();
    expect(hook.received).toHaveLength(1);
  });

  it('enable refuses a webhook without a secret', async () => {
    const { h, id } = await hooked({ enable: false });
    await h.base.services.connections.removeSecret(id, 'signing_secret');
    await expect(h.notifications.webhooks.enable(id)).rejects.toThrow(/secret/);
  });

  it('disable fails what waits to be sent, with the reason', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS));
    await h.notifications.webhooks.disable(id);
    const [one] = h.notifications.webhooks.log(id, {});
    expect(one?.state).toBe('failed');
    expect(one?.error).toBe('webhook disabled');
    await after(h, HOUR);
    expect(hook.received).toHaveLength(1);
  });

  it('removing the connection removes the subscription and its journal', async () => {
    const { h, id } = await hooked();
    await h.save(asking(QUESTIONS));
    await h.base.services.connections.remove(id);
    expect(await h.notifications.webhooks.list()).toEqual([]);
    expect(
      h.base.database.prepare('SELECT COUNT(*) AS n FROM notification_subscriptions').get(),
    ).toEqual({
      n: 0,
    });
    expect(
      h.base.database.prepare('SELECT COUNT(*) AS n FROM notification_attempts').get(),
    ).toEqual({
      n: 0,
    });
  });
});

describe('webhook test, log, redeliver', () => {
  it('test sends one webhook.test call, also while the webhook is off', async () => {
    const { h, hook, id } = await hooked({ enable: false });
    const result = await h.notifications.webhooks.test(id);
    expect(result).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(JSON.parse(hook.received[0]!.body).type).toBe('webhook.test');
  });

  it('test reports a refusal without retrying it', async () => {
    const { h, hook, id } = await hooked({ enable: false });
    hook.answers.push({ status: 500 });
    const result = await h.notifications.webhooks.test(id);
    expect(result).toMatchObject({ ok: false, statusCode: 500, error: 'server_error' });
    await after(h, HOUR);
    expect(hook.received).toHaveLength(1);
  });

  it('a slow test call is not picked up by the dispatcher meanwhile', async () => {
    const { h, hook, id } = await hooked({ enable: false });
    hook.answers.push({ status: 500, delayMs: 300 });
    const pending = h.notifications.webhooks.test(id);
    await hook.waitFor(1);
    await h.notifications.dispatcher.flush();
    h.notifications.dispatcher.wake();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, statusCode: 500 });
    await after(h, HOUR);
    expect(hook.received).toHaveLength(1);
  });

  it('a test call that a restart interrupted is closed as failed, not left pending', async () => {
    const { h, hook, id } = await hooked({ enable: false });
    await h.notifications.webhooks.test(id);
    h.base.database
      .prepare("UPDATE notification_deliveries SET state = 'pending', last_error = NULL")
      .run();
    expect(h.notifications.webhooks.log(id, {})[0]?.state).toBe('pending');
    h.restart();
    await h.notifications.dispatcher.idle();
    expect(h.notifications.webhooks.log(id, {})[0]).toMatchObject({
      state: 'failed',
      error: 'interrupted',
    });
    await after(h, HOUR);
    expect(hook.received).toHaveLength(1);
  });

  it('redeliver of a test call is refused, failed or sent', async () => {
    const { h, hook, id } = await hooked({ enable: true });
    hook.answers.push({ status: 500 });
    await h.notifications.webhooks.test(id);
    const [failed] = h.notifications.webhooks.log(id, {});
    expect(failed).toMatchObject({ type: 'webhook.test', state: 'failed' });
    expect(
      await failureOf(Promise.resolve().then(() => h.notifications.webhooks.redeliver(failed!.id))),
    ).toBe('not_redeliverable');
    await h.notifications.webhooks.test(id);
    const sent = h.notifications.webhooks.log(id, {})[0]!;
    expect(sent.state).toBe('sent');
    expect(() => h.notifications.webhooks.redeliver(sent.id)).toThrow(/sent again/);
    await after(h, HOUR);
    expect(hook.received).toHaveLength(2);
    expect(h.notifications.webhooks.log(id, { state: 'pending' })).toHaveLength(0);
  });

  it('test of a webhook without a secret is refused', async () => {
    const { h, id } = await hooked({ enable: false });
    await h.base.services.connections.removeSecret(id, 'signing_secret');
    expect(await failureOf(h.notifications.webhooks.test(id))).toBe('connection_disabled');
  });

  it('log shows the newest first and filters by state', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS, { id: 'run000000001' }));
    await h.save(asking(QUESTIONS, { id: 'run000000002' }));
    const all = h.notifications.webhooks.log(id, {});
    expect(all.map((one) => one.run)).toEqual(['run000000002', 'run000000001']);
    expect(h.notifications.webhooks.log(id, { state: 'pending' }).map((one) => one.run)).toEqual([
      'run000000001',
    ]);
    expect(h.notifications.webhooks.log(id, { limit: 1 })).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain('token=abc');
  });

  it('redeliver sends a sent delivery again with the same webhook-id and body', async () => {
    const { h, hook, id } = await hooked();
    await h.save(asking(QUESTIONS));
    const [one] = h.notifications.webhooks.log(id, {});
    const again = h.notifications.webhooks.redeliver(one!.id);
    expect(again.state).toBe('pending');
    await h.notifications.dispatcher.flush();
    expect(hook.received).toHaveLength(2);
    expect(hook.received[1]?.headers['webhook-id']).toBe(hook.received[0]?.headers['webhook-id']);
    expect(hook.received[1]?.body).toBe(hook.received[0]?.body);
  });

  it('redeliver of a failed delivery starts a new series', async () => {
    const { h, hook, id } = await hooked();
    for (let i = 0; i < 8; i += 1) hook.answers.push({ status: 500 });
    await h.save(asking(QUESTIONS));
    for (let i = 0; i < 10; i += 1) await after(h, 12 * HOUR);
    const [failed] = h.notifications.webhooks.log(id, {});
    expect(failed?.state).toBe('failed');
    h.notifications.webhooks.redeliver(failed!.id);
    await h.notifications.dispatcher.flush();
    expect(h.notifications.webhooks.log(id, {})[0]?.state).toBe('sent');
  });

  it('redeliver is refused for a switched-off webhook, a pending delivery and a stranger', async () => {
    const { h, hook, id } = await hooked();
    hook.answers.push({ status: 503 });
    await h.save(asking(QUESTIONS));
    const [pending] = h.notifications.webhooks.log(id, {});
    expect(() => h.notifications.webhooks.redeliver(pending!.id)).toThrow(/sent again/);
    expect(() => h.notifications.webhooks.redeliver(9999)).toThrow(/not found/);
    await h.notifications.webhooks.disable(id);
    expect(() => h.notifications.webhooks.redeliver(pending!.id)).toThrow(/disabled/);
  });
});
