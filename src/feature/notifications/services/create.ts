import type { Database } from '../../../platform/sqlite/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { ChannelFactoryPort, NotificationsPublishPort } from '../ports/index.ts';
import {
  AnswerRepository,
  CursorRepository,
  DeliveryOutcomes,
  DeliveryRepository,
  SubscriptionRepository,
} from '../repositories/index.ts';
import { notificationEvents } from '../types/index.ts';

import { NotificationChannels } from './channels.ts';
import { NotificationDispatcher } from './dispatcher.ts';
import { ChannelFactories } from './factories.ts';
import { NotificationInbound } from './inbound.ts';
import { JournalService } from './journal.ts';
import { SubscriptionService } from './subscriptions.ts';

export interface NotificationsServices {
  subscriptions: SubscriptionService;
  journal: JournalService;
  dispatcher: NotificationDispatcher;
  inbound: NotificationInbound;
  channels: NotificationChannels;
  factories: ChannelFactories;
}

export interface NotificationsDependencies {
  database: Database;
  integrations: IntegrationsServices;
  registry: RegistryService;
  runs: RunsServices;
  config: ConfigService;
  /** The built-in channel kinds of this build. */
  kinds: readonly ChannelFactoryPort[];
  publish: NotificationsPublishPort;
  log: (message: string) => void;
  now: () => number;
  /** The pause before a listener that stopped by itself is started again. */
  restartMs?: number;
  /** How long a finished delivery stays in the journal. */
  retentionMs?: number;
}

/** The notifications over a database: subscriptions, the outgoing queue, the channels, the answers. */
export function createNotificationsServices(
  dependencies: NotificationsDependencies,
): NotificationsServices {
  const { database, integrations, registry, runs, config, publish, log, now } = dependencies;
  const subscriptionRows = new SubscriptionRepository(database);
  const deliveries = new DeliveryRepository(database);
  const outcomes = new DeliveryOutcomes(database);
  const answers = new AnswerRepository(database);
  const cursors = new CursorRepository(database);
  const factories = new ChannelFactories(dependencies.kinds);
  // The pieces need each other: the late names are read only once everything is built.
  const late: { dispatcher?: NotificationDispatcher; inbound?: NotificationInbound } = {};
  const subscriptions = new SubscriptionService({
    subscriptions: subscriptionRows,
    deliveries,
    integrations,
    registry,
    factories,
    events: () => runs.states.all().flatMap((state) => notificationEvents(state)),
    changed: () => late.dispatcher?.resync(),
    publish,
    now,
  });
  const channels = new NotificationChannels({
    integrations,
    factories,
    cursors,
    subscriptions: subscriptionRows,
    outcomes,
    handle: (id, input) => {
      if (late.inbound === undefined) throw new Error('the notifications are not built yet');
      return late.inbound.handle(id, input);
    },
    publish,
    log,
    now,
    ...(dependencies.restartMs === undefined ? {} : { restartMs: dependencies.restartMs }),
  });
  const outbox = {
    subscriptions,
    deliveries,
    outcomes,
    answers,
    channels,
    factories,
    config,
    publish,
    log,
    now,
  };
  const dispatcher = new NotificationDispatcher({
    ...outbox,
    states: () => runs.states.all(),
    pruneClaims: (before) => integrations.inbound.pruneClaims(before),
    ...(dependencies.retentionMs === undefined ? {} : { retentionMs: dependencies.retentionMs }),
  });
  const inbound = new NotificationInbound({ ...outbox, integrations, runs });
  late.dispatcher = dispatcher;
  late.inbound = inbound;
  return {
    subscriptions,
    journal: new JournalService(deliveries),
    dispatcher,
    inbound,
    channels,
    factories,
  };
}
