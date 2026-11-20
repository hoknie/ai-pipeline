import type { Database } from '../../../platform/sqlite/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { ChannelFactoryPort, NotificationsPublishPort } from '../ports/index.ts';
import {
  AnswerRepository,
  AttemptRepository,
  CursorRepository,
  DeliveryOutcomes,
  DeliveryRepository,
  SubscriptionRepository,
} from '../repositories/index.ts';
import { notificationEvents, type NotificationEvent } from '../types/index.ts';

import { NotificationChannels } from './channels.ts';
import { NotificationDispatcher } from './dispatcher.ts';
import { ChannelFactories } from './factories.ts';
import { NotificationInbound } from './inbound.ts';
import { JournalService } from './journal.ts';
import { isChatConnection, SubscriptionService } from './subscriptions.ts';
import { FailureStreaks, WebhookService } from './webhooks/index.ts';

export interface NotificationsServices {
  subscriptions: SubscriptionService;
  journal: JournalService;
  dispatcher: NotificationDispatcher;
  inbound: NotificationInbound;
  channels: NotificationChannels;
  factories: ChannelFactories;
  webhooks: WebhookService;
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

/** The pieces that are built after the ones that call them. */
interface Late {
  dispatcher?: NotificationDispatcher;
  inbound?: NotificationInbound;
  webhooks?: WebhookService;
}

/** The events the runs hold now. */
function eventsOf(runs: RunsServices): () => NotificationEvent[] {
  return () => runs.states.all().flatMap((state) => notificationEvents(state));
}

/** The ids of the subscriptions of webhooks: their deliveries have a journal of their own. */
function webhookIdsOf(
  rows: SubscriptionRepository,
  integrations: IntegrationsServices,
  factories: ChannelFactories,
): () => string[] {
  return () =>
    rows
      .all()
      .filter((one) => !isChatConnection(integrations, factories, one.connectionId))
      .map((one) => one.id);
}

/** The tables the notifications own, one repository each. */
function repositoriesOf(database: Database) {
  return {
    subscriptionRows: new SubscriptionRepository(database),
    deliveries: new DeliveryRepository(database),
    outcomes: new DeliveryOutcomes(database),
    answers: new AnswerRepository(database),
    cursors: new CursorRepository(database),
    attempts: new AttemptRepository(database),
  };
}

/** The notifications over a database: subscriptions, the outgoing queue, the channels, the answers. */
export function createNotificationsServices(
  dependencies: NotificationsDependencies,
): NotificationsServices {
  const { database, integrations, registry, runs, config, publish, log, now } = dependencies;
  const { subscriptionRows, deliveries, outcomes, answers, cursors, attempts } =
    repositoriesOf(database);
  const factories = new ChannelFactories(dependencies.kinds);
  // The pieces need each other: the late names are read only once everything is built.
  const late: Late = {};
  const subscriptions = new SubscriptionService({
    subscriptions: subscriptionRows,
    deliveries,
    integrations,
    registry,
    factories,
    events: eventsOf(runs),
    changed: () => late.dispatcher?.resync(),
    publish,
    now,
  });
  const channels = new NotificationChannels({
    integrations,
    factories,
    cursors,
    attempts,
    subscriptions: subscriptionRows,
    outcomes,
    handle: (id, input) => {
      if (late.inbound === undefined) throw new Error('the notifications are not built yet');
      return late.inbound.handle(id, input);
    },
    publish,
    settle: (id, change) => late.webhooks?.changed(id, change),
    log,
    now,
    ...(dependencies.restartMs === undefined ? {} : { restartMs: dependencies.restartMs }),
  });
  const outbox = {
    subscriptions,
    streaks: new FailureStreaks({ subscriptions: subscriptionRows, integrations, publish }),
    deliveries,
    outcomes,
    answers,
    attempts,
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
  const webhooks = new WebhookService({
    ...outbox,
    subscriptionRows,
    events: eventsOf(runs),
    integrations,
    resync: () => late.dispatcher?.resync(),
    wake: () => late.dispatcher?.wake(),
  });
  Object.assign(late, { webhooks, dispatcher, inbound });
  return {
    subscriptions,
    journal: new JournalService(
      deliveries,
      webhookIdsOf(subscriptionRows, integrations, factories),
    ),
    dispatcher,
    inbound,
    channels,
    factories,
    webhooks,
  };
}
