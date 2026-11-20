import { afterEach, describe, expect, it } from 'vitest';

import type {
  ConnectionView,
  DeliveryView,
  SubscriptionView,
} from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { startFakeTelegram, type FakeTelegram } from '../fakes/telegram-api.ts';
import { MemoryStore, SENTINEL } from '../feature/integrations/helpers.ts';
import { harness, type Harness } from '../daemon/harness.ts';

let h: Harness | null = null;
let web: WebServer | null = null;
let fake: FakeTelegram | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  await fake?.close();
  web = h = fake = null;
});

const JSON_TYPE = { 'content-type': 'application/json' };

async function setup() {
  fake = await startFakeTelegram();
  h = await harness(
    undefined,
    { AIP_TELEGRAM_API: fake.base },
    { integrations: { secretStore: new MemoryStore() } },
  );
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
  const base = `http://127.0.0.1:${web.port}`;
  const authed = (extra: Record<string, string> = {}) => ({
    'x-aip-token': web!.token ?? '',
    ...extra,
  });
  const get = (path: string) => fetch(`${base}${path}`, { headers: authed() });
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: authed(JSON_TYPE),
      body: JSON.stringify(body),
    });
  const added = (await h.call('integration_add', {
    kind: 'telegram',
    name: 'main',
    global: true,
    params: { allowed_users: '111' },
  })) as ConnectionView;
  return { h, fake, base, get, post, id: added.id };
}

async function enable(id: string) {
  await h!.call('integration_secret_set', { id, slot: 'bot_token', value: fake!.token });
  await h!.call('integration_edit', { id, set: { chat_id: '-1001' } });
  await h!.call('integration_enable', { id });
}

describe('the panel API of integrations', () => {
  it('is protected like the rest of the API', async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/api/integrations`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/notifications`, {
          method: 'POST',
          headers: JSON_TYPE,
          body: JSON.stringify({ connection: 'c' }),
        })
      ).status,
    ).toBe(401);
  });

  it('shows connections with the presence of secrets and the command that sets one, never a value', async () => {
    const { get, id } = await setup();
    const before = (await (await get('/api/integrations')).json()) as {
      connections: ConnectionView[];
      types: { kind: string; secrets: { slot: string }[] }[];
    };
    expect(before.connections[0]).toMatchObject({ id, kind: 'telegram', enabled: false });
    expect(before.connections[0]!.secrets).toEqual([
      { slot: 'bot_token', required: true, present: false },
    ]);
    expect(before.types.find((type) => type.kind === 'telegram')?.secrets[0]?.slot).toBe(
      'bot_token',
    );
    await enable(id);
    const text = await (await get('/api/integrations')).text();
    expect(text).not.toContain(fake!.token);
    expect(JSON.parse(text).connections[0].secrets[0].present).toBe(true);
  });

  it('edits the non-secret parameters and refuses a secret in any field', async () => {
    const { post, get, id } = await setup();
    const edited = await post('/api/integrations/edit', { id, set: { chat_id: '-77' } });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as ConnectionView).params.chat_id).toBe('-77');

    for (const body of [
      { id, set: { bot_token: SENTINEL } },
      { id, value: SENTINEL },
      { id, secret: SENTINEL },
      { id, set: { chat_id: SENTINEL } },
    ]) {
      const refused = await post('/api/integrations/edit', body);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await refused.text()).not.toContain(SENTINEL);
    }
    const after = (await (await get('/api/integrations')).json()) as {
      connections: ConnectionView[];
    };
    expect(after.connections[0]!.params).toEqual({ allowed_users: '111', chat_id: '-77' });
    expect(JSON.stringify(after)).not.toContain(SENTINEL);
  });

  it('makes, enables, disables and removes a connection, and refuses a secret in the body', async () => {
    const { post, get } = await setup();
    const made = await post('/api/integrations', {
      kind: 'telegram',
      name: 'second',
      global: true,
      params: { allowed_users: '222' },
    });
    expect(made.status).toBe(200);
    const view = (await made.json()) as ConnectionView;
    expect(view).toMatchObject({ kind: 'telegram', name: 'second', enabled: false });

    const early = await post('/api/integrations/enable', { id: view.id });
    expect(early.status).toBeGreaterThanOrEqual(400);

    await h!.call('integration_secret_set', {
      id: view.id,
      slot: 'bot_token',
      value: fake!.token,
    });
    await h!.call('integration_edit', { id: view.id, set: { chat_id: '-1001' } });
    const on = await post('/api/integrations/enable', { id: view.id });
    expect(((await on.json()) as ConnectionView).enabled).toBe(true);
    const off = await post('/api/integrations/disable', { id: view.id });
    expect(((await off.json()) as ConnectionView).enabled).toBe(false);

    const removed = await post('/api/integrations/remove', { id: view.id });
    expect(removed.status).toBe(200);
    const left = (await (await get('/api/integrations')).json()) as {
      connections: ConnectionView[];
    };
    expect(left.connections.map((one) => one.name)).toEqual(['main']);

    for (const body of [
      { kind: 'telegram', name: 'third', global: true, bot_token: SENTINEL },
      { kind: 'telegram', name: 'third', global: true, secrets: { bot_token: SENTINEL } },
      { kind: 'telegram', name: 'third', global: true, value: SENTINEL },
    ]) {
      const refused = await post('/api/integrations', body);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await refused.text()).not.toContain(SENTINEL);
    }
    const refusedAction = await post('/api/integrations/enable', { id: view.id, value: SENTINEL });
    expect(refusedAction.status).toBeGreaterThanOrEqual(400);
    expect(await refusedAction.text()).not.toContain(SENTINEL);
  });

  it('checks a connection through the API and keeps the routes closed without a login', async () => {
    const { post, base, id } = await setup();
    const checked = await post('/api/integrations/check', { id });
    expect(checked.status).toBeLessThan(500);
    expect(await checked.text()).not.toContain(SENTINEL);
    for (const path of ['', '/enable', '/disable', '/remove', '/check']) {
      const response = await fetch(`${base}/api/integrations${path}`, {
        method: 'POST',
        headers: JSON_TYPE,
        body: JSON.stringify({ id }),
      });
      expect(response.status).toBe(401);
    }
  });

  it('has no route that carries a secret', async () => {
    const { post, id } = await setup();
    for (const path of [
      '/api/integrations/secret',
      '/api/integrations/secret/set',
      '/api/integrations/secret/remove',
    ]) {
      const response = await post(path, { id, slot: 'bot_token', value: SENTINEL });
      expect([404, 405]).toContain(response.status);
      expect(await response.text()).not.toContain(SENTINEL);
    }
  });

  it('manages subscriptions and filters the journal by state', async () => {
    const { post, get, id } = await setup();
    await enable(id);
    const added = await post('/api/notifications', { connection: id, allProjects: true });
    expect(added.status).toBe(200);
    const subscription = (await added.json()) as SubscriptionView;
    expect(subscription).toMatchObject({ project: null, events: ['question'], enabled: true });

    const edited = await post('/api/notifications/edit', {
      id: subscription.id,
      events: ['question', 'failed'],
    });
    expect(((await edited.json()) as SubscriptionView).events).toEqual(['question', 'failed']);
    const off = await post('/api/notifications/disable', { id: subscription.id });
    expect(((await off.json()) as SubscriptionView).enabled).toBe(false);
    const on = await post('/api/notifications/enable', { id: subscription.id });
    expect(((await on.json()) as SubscriptionView).enabled).toBe(true);

    const test = await post('/api/notifications/test', { id: subscription.id });
    expect(test.status).toBe(200);
    expect(fake!.messages.at(-1)?.chat_id).toBe(-1001);
    const sent = (await (
      await get(`/api/notifications/log?subscription=${subscription.id}&state=sent`)
    ).json()) as DeliveryView[];
    expect(sent).toHaveLength(1);
    const failed = (await (await get('/api/notifications/log?state=failed')).json()) as unknown[];
    expect(failed).toEqual([]);

    expect((await post('/api/notifications/remove', { id: subscription.id })).status).toBe(200);
    const left = (await (await get('/api/integrations')).json()) as {
      subscriptions: unknown[];
    };
    expect(left.subscriptions).toEqual([]);
  });

  it('refuses an unknown event kind and a bad journal filter', async () => {
    const { post, get, id } = await setup();
    await enable(id);
    const unknown = await post('/api/notifications', {
      connection: id,
      allProjects: true,
      events: ['nothing'],
    });
    expect(unknown.status).toBe(400);
    expect((await get('/api/notifications/log?state=bogus')).status).toBeGreaterThanOrEqual(400);
    expect((await get('/api/notifications/log?limit=0')).status).toBeGreaterThanOrEqual(400);
  });
});
