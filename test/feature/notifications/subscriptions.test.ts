import { describe, expect, it } from 'vitest';

import {
  DeliveryRepository,
  SubscriptionRepository,
} from '../../../src/feature/notifications/repositories/index.ts';
import { ChannelFactories } from '../../../src/feature/notifications/services/factories.ts';
import { SubscriptionService } from '../../../src/feature/notifications/services/subscriptions.ts';
import type { NotificationEvent } from '../../../src/feature/notifications/types/index.ts';

import { chatAdapter, chatConnection, eventOf, fakeChannels, fixture } from './helpers.ts';

async function setup(events: NotificationEvent[] = []) {
  const base = fixture({ adapters: [chatAdapter()] });
  const { database, registry } = base;
  const changes = { changed: 0, published: 0 };
  const subscriptions = new SubscriptionRepository(database);
  const deliveries = new DeliveryRepository(database);
  const service = new SubscriptionService({
    subscriptions,
    deliveries,
    integrations: base.services,
    registry,
    factories: new ChannelFactories([fakeChannels().factory]),
    events: () => events,
    changed: () => (changes.changed += 1),
    publish: {
      subscriptionsChanged: () => (changes.published += 1),
      journalChanged: () => undefined,
      channelChanged: () => undefined,
    },
    now: () => 1000,
  });
  return { base, service, deliveries, changes, connection: await chatConnection(base) };
}

describe('subscriptions', () => {
  it('gets only the questions without an explicit set', async () => {
    const { service, connection, changes } = await setup();
    const added = await service.add({ connection, repository: 'app' });
    expect(added).toMatchObject({
      connection,
      connectionName: 'main',
      kind: 'chat',
      project: '/work/app',
      events: ['question'],
      enabled: true,
    });
    expect(changes).toEqual({ changed: 1, published: 1 });
  });

  it('takes a set of events in the order of the table and refuses an unknown one', async () => {
    const { service, connection } = await setup();
    const added = await service.add({
      connection,
      repository: 'app',
      events: ['finished', 'question', 'question'],
    });
    expect(added.events).toEqual(['question', 'finished']);
    await expect(
      service.add({ connection, repository: 'app', events: ['step_done'] }),
    ).rejects.toThrow(/allowed: question, failed, conflict, delivery, finished/);
    await expect(service.add({ connection, repository: 'app', events: [] })).rejects.toThrow(
      /at least one/,
    );
  });

  it('subscribes a shared connection to one project or to all of them', async () => {
    const { service, connection } = await setup();
    const all = await service.add({ connection, allProjects: true });
    expect(all.project).toBeNull();
    await expect(service.add({ connection })).rejects.toThrow(/choose either/);
    await expect(service.add({ connection, repository: 'app', allProjects: true })).rejects.toThrow(
      /choose either/,
    );
    await expect(service.add({ connection, repository: 'nowhere' })).rejects.toThrow(
      /not registered/,
    );
  });

  it('keeps a project connection to its own project', async () => {
    const { base, service } = await setup();
    const own = await chatConnection(base, { name: 'own', repository: 'app' });
    expect((await service.add({ connection: own, repository: 'app' })).project).toBe('/work/app');
    await expect(service.add({ connection: own, repository: 'lib' })).rejects.toThrow(
      /another project/,
    );
    await expect(service.add({ connection: own, allProjects: true })).rejects.toThrow(
      /another project/,
    );
  });

  it('refuses a missing, disabled or foreign connection', async () => {
    const { base, service } = await setup();
    await expect(service.add({ connection: 'nope', repository: 'app' })).rejects.toThrow(
      /not found/,
    );
    const off = await chatConnection(base, { name: 'off', enabled: false });
    await expect(service.add({ connection: off, repository: 'app' })).rejects.toThrow(
      /disabled or incomplete/,
    );
  });

  it('refuses a connection of a kind that is not a chat', async () => {
    const base = fixture();
    const service = new SubscriptionService({
      subscriptions: new SubscriptionRepository(base.database),
      deliveries: new DeliveryRepository(base.database),
      integrations: base.services,
      registry: base.registry,
      factories: new ChannelFactories([]),
      events: () => [],
      changed: () => undefined,
      publish: {
        subscriptionsChanged: () => undefined,
        journalChanged: () => undefined,
        channelChanged: () => undefined,
      },
      now: () => 1,
    });
    const added = await base.services.connections.add({ kind: 'example', name: 'x', global: true });
    await expect(service.add({ connection: added.id, repository: 'app' })).rejects.toThrow(
      /not a chat channel/,
    );
  });

  it('does not enable a subscription of a connection without a chat', async () => {
    const { base, service } = await setup();
    const bare = await chatConnection(base, { name: 'bare', params: {} });
    await expect(service.add({ connection: bare, repository: 'app' })).rejects.toThrow(
      /lacks a parameter.*chat_id/,
    );
    const chat = await chatConnection(base, { name: 'withchat' });
    const added = await service.add({ connection: chat, repository: 'app' });
    service.disable(added.id);
    await base.services.connections.edit(chat, { set: {}, unset: ['chat_id'] });
    expect(() => service.enable(added.id)).toThrow(/chat_id/);
  });

  it('edits the events, switches and removes', async () => {
    const { service, connection } = await setup();
    const { id } = await service.add({ connection, repository: 'app' });
    expect((await service.edit(id, ['failed'])).events).toEqual(['failed']);
    expect(service.disable(id).enabled).toBe(false);
    expect(service.enable(id).enabled).toBe(true);
    expect((await service.list()).map((one) => one.id)).toEqual([id]);
    expect(await service.list('lib')).toEqual([]);
    expect((await service.list('app')).map((one) => one.id)).toEqual([id]);
    service.remove(id);
    expect(await service.list()).toEqual([]);
    expect(() => service.remove(id)).toThrow(/not found/);
  });

  it('survives a restart: the subscription is in the database', async () => {
    const { base, service, connection } = await setup();
    await service.add({ connection, repository: 'app' });
    const again = new SubscriptionRepository(base.database).all();
    expect(again).toHaveLength(1);
  });

  it('sends the open questions of the project and not what happened before', async () => {
    const question = eventOf({ key: 'q1' });
    const failure = eventOf({ key: 'f1', kind: 'failed' });
    const elsewhere = eventOf({ key: 'f2', kind: 'failed', repository: '/work/lib' });
    const { service, connection, deliveries } = await setup([question, failure, elsewhere]);
    const { id } = await service.add({
      connection,
      repository: 'app',
      events: ['question', 'failed'],
    });
    expect(deliveries.ofEvent('q1')).toEqual([]);
    expect(deliveries.ofEvent('f1')).toMatchObject([
      { subscriptionId: id, state: 'closed', closedBy: 'before_subscription' },
    ]);
    expect(deliveries.ofEvent('f2')).toEqual([]);
  });

  it('does not send the kinds added later that already happened', async () => {
    const finished = eventOf({ key: 'e1', kind: 'finished', group: null });
    const { service, connection, deliveries } = await setup([finished]);
    const { id } = await service.add({ connection, repository: 'app' });
    expect(deliveries.ofEvent('e1')).toEqual([]);
    await service.edit(id, ['question', 'finished']);
    expect(deliveries.ofEvent('e1')[0]?.state).toBe('closed');
  });

  it('moves with the project and goes with a forgotten one', async () => {
    const { service, connection } = await setup();
    await service.add({ connection, repository: 'app' });
    service.moveProject('/work/app', '/work/new');
    expect((await service.list()).map((one) => one.project)).toEqual(['/work/new']);
    service.forgetProject('/work/new');
    expect(await service.list()).toEqual([]);
  });

  it('selects the enabled subscriptions that want an event', async () => {
    const { service, connection } = await setup();
    const one = await service.add({ connection, repository: 'app' });
    await service.add({ connection, repository: 'lib' });
    const all = await service.add({ connection, allProjects: true, events: ['failed'] });
    const event = eventOf();
    expect(service.matching(event).map((sub) => sub.id)).toEqual([one.id]);
    expect(service.matching(eventOf({ kind: 'failed' })).map((sub) => sub.id)).toEqual([all.id]);
    service.disable(one.id);
    expect(service.matching(event)).toEqual([]);
  });
});
