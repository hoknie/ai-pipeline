import { randomBytes } from 'node:crypto';

import type { IntegrationsServices } from '../../../integrations/services/index.ts';
import type { Connection, ConnectionChange } from '../../../integrations/types/index.ts';
import type { NotificationsPublishPort } from '../../ports/index.ts';
import type {
  AttemptRepository,
  DeliveryOutcomes,
  DeliveryRepository,
  SubscriptionRepository,
} from '../../repositories/index.ts';
import {
  DEFAULT_EVENTS,
  displayUrl,
  emptyEventData,
  notificationRefusal,
  type Delivery,
  type DeliveryState,
  type Subscription,
  WEBHOOK_KIND,
  webhookType,
  type WebhookDeliveryView,
  type WebhookTestView,
  type WebhookView,
  type NotificationEvent,
} from '../../types/index.ts';

import type { NotificationChannels } from '../channels.ts';
import { drawOf } from '../drawing.ts';
import type { ChannelFactories } from '../factories.ts';
import { checkedEvents, closeExisting, type SubscriptionService } from '../subscriptions.ts';

export interface WebhookDependencies {
  subscriptions: SubscriptionService;
  subscriptionRows: SubscriptionRepository;
  factories: ChannelFactories;
  /** The events the runs hold now; the ones from before a webhook came back are not sent. */
  events: () => NotificationEvent[];
  deliveries: DeliveryRepository;
  outcomes: DeliveryOutcomes;
  attempts: AttemptRepository;
  integrations: IntegrationsServices;
  channels: NotificationChannels;
  publish: NotificationsPublishPort;
  /** Looks at the runs again, after a subscription came back. */
  resync: () => void;
  /** Sends what is due now. */
  wake: () => void;
  now: () => number;
}

export interface NewWebhook {
  name: string;
  url: string;
  /** A project reference (path or slug); absent with `allProjects`. */
  repository?: string | undefined;
  allProjects?: boolean | undefined;
  events?: readonly string[] | undefined;
}

export const WEBHOOK_LOG_LIMIT = 200;

/**
 * Webhooks: a connection of the kind `webhook` and exactly one subscription of the core, made and
 * removed together. Every operation takes the id of the connection.
 */
export class WebhookService {
  private readonly dependencies: WebhookDependencies;

  constructor(dependencies: WebhookDependencies) {
    this.dependencies = dependencies;
  }

  async list(repository?: string): Promise<WebhookView[]> {
    const { integrations } = this.dependencies;
    const views = await integrations.connections.list(repository);
    return views.flatMap((one) => {
      if (one.kind !== WEBHOOK_KIND) return [];
      const subscription = this.subscriptionOf(one.id);
      return subscription === undefined
        ? []
        : [this.view(integrations.access.find(one.id), subscription)];
    });
  }

  /** Makes the connection, switched off and without its secret, and its subscription. */
  async add(request: NewWebhook): Promise<WebhookView> {
    const { integrations, subscriptionRows, publish, now } = this.dependencies;
    if ((request.allProjects === true) === (request.repository !== undefined)) {
      throw notificationRefusal('scope_required');
    }
    const events =
      request.events === undefined ? [...DEFAULT_EVENTS] : checkedEvents(request.events);
    const added = await integrations.connections.add(
      {
        kind: WEBHOOK_KIND,
        name: request.name,
        ...(request.allProjects === true ? { global: true } : { repository: request.repository }),
        params: { url: request.url },
      },
      { managed: true },
    );
    const subscription: Subscription = {
      id: `n${randomBytes(6).toString('hex')}`,
      connectionId: added.id,
      projectPath: added.project,
      events,
      enabled: true,
      failureStreak: 0,
      disabledReason: null,
      createdAt: now(),
      updatedAt: now(),
    };
    try {
      subscriptionRows.insert(subscription);
    } catch (error) {
      // The pair is made together or not at all.
      await integrations.connections.remove(added.id).catch(() => undefined);
      throw error;
    }
    publish.subscriptionsChanged();
    return this.view(integrations.access.find(added.id), subscription);
  }

  /** A new address and/or new events; what waits to be sent goes to the new address. */
  async edit(
    id: string,
    change: { url?: string | undefined; events?: readonly string[] | undefined },
  ): Promise<WebhookView> {
    const { integrations, subscriptions } = this.dependencies;
    this.connectionOf(id);
    if (change.url === undefined && change.events === undefined) {
      throw notificationRefusal('nothing_to_edit');
    }
    const subscription = this.subscriptionRequired(id);
    if (change.events !== undefined) checkedEvents(change.events);
    if (change.url !== undefined)
      await integrations.connections.edit(id, { set: { url: change.url } });
    if (change.events !== undefined) {
      await subscriptions.edit(subscription.id, change.events, { webhook: true });
    }
    return this.get(id);
  }

  async enable(id: string): Promise<WebhookView> {
    this.connectionOf(id);
    await this.dependencies.integrations.connections.enable(id);
    return this.get(id);
  }

  async disable(id: string): Promise<WebhookView> {
    this.connectionOf(id);
    this.dependencies.integrations.connections.disable(id);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    this.connectionOf(id);
    await this.dependencies.integrations.connections.remove(id);
  }

  /** One call with the event `webhook.test`, no retries; allowed while the webhook is off. */
  async test(id: string): Promise<WebhookTestView> {
    const { deliveries, outcomes, attempts, channels, publish, now } = this.dependencies;
    const subscription = this.subscriptionRequired(id);
    const opened = channels.open(id, { disabled: true });
    if (opened === null) throw notificationRefusal('connection_disabled');
    if (!this.dependencies.integrations.access.complete(opened.connection)) {
      throw notificationRefusal('connection_disabled');
    }
    const delivery = deliveries.claim(
      {
        subscriptionId: subscription.id,
        eventKey: `test/${now()}/${randomBytes(4).toString('hex')}`,
        kind: 'test',
        run: '-',
        group: null,
        questionKey: null,
        payload: emptyEventData(),
      },
      now(),
    );
    if (delivery === null) throw notificationRefusal('channel_failed');
    let failure: string | null = null;
    try {
      const ref = await opened.channel.deliver({
        delivery,
        draw: drawOf(delivery, [], null, opened, null),
        publicUrl: null,
      });
      outcomes.markSent(delivery.id, ref, 1, now());
    } catch (error) {
      failure = (error as { message?: string }).message ?? 'unexpected channel error';
      outcomes.markFailed(delivery.id, 1, failure, now());
    }
    publish.journalChanged(delivery.id);
    const last = attempts.ofDelivery(delivery.id).at(-1);
    return {
      ok: failure === null,
      statusCode: last?.statusCode ?? null,
      durationMs: last?.durationMs ?? 0,
      error: failure === null ? null : (last?.errorKind ?? 'failed'),
    };
  }

  /** The deliveries of a webhook, the newest first, with their attempts. */
  log(
    id: string,
    filter: { state?: DeliveryState | undefined; limit?: number | undefined },
  ): WebhookDeliveryView[] {
    const { deliveries } = this.dependencies;
    const subscription = this.subscriptionRequired(id);
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), WEBHOOK_LOG_LIMIT);
    return deliveries
      .journal({ subscription: subscription.id, state: filter.state, limit })
      .map((delivery) => this.deliveryView(delivery));
  }

  /** A new series of attempts for a delivery with the same `webhook-id` and body. */
  redeliver(deliveryId: number): WebhookDeliveryView {
    const { deliveries, outcomes, publish, wake, now } = this.dependencies;
    const delivery = deliveries.find(deliveryId);
    const subscription =
      delivery && this.dependencies.subscriptionRows.find(delivery.subscriptionId);
    if (delivery === undefined || subscription === undefined || !this.isWebhook(subscription)) {
      throw notificationRefusal('no_webhook');
    }
    const connection = this.dependencies.integrations.access.find(subscription.connectionId);
    if (!connection.enabled) throw notificationRefusal('connection_disabled');
    if (!outcomes.reopen(deliveryId, now())) throw notificationRefusal('not_redeliverable');
    publish.journalChanged(deliveryId);
    wake();
    return this.deliveryView(deliveries.find(deliveryId)!);
  }

  /** What a change of a connection means for its webhook; other kinds are not its business. */
  changed(id: string, change: ConnectionChange): void {
    const { subscriptionRows, outcomes, publish, resync, now } = this.dependencies;
    if (change !== 'enabled' && change !== 'disabled') return;
    const subscription = this.subscriptionOf(id);
    if (subscription === undefined || !this.isWebhook(subscription)) return;
    if (change === 'enabled') {
      subscriptionRows.setFailures(subscription.id, 0, null);
      // What happened while the webhook was off is not sent.
      closeExisting(this.dependencies, subscription, subscription.events);
      resync();
    } else {
      outcomes.failPendingOfConnection(id, 'webhook disabled', now());
    }
    publish.subscriptionsChanged();
  }

  private get(id: string): WebhookView {
    return this.view(this.connectionOf(id), this.subscriptionRequired(id));
  }

  private connectionOf(id: string): Connection {
    let connection: Connection;
    try {
      connection = this.dependencies.integrations.access.find(id);
    } catch {
      throw notificationRefusal('no_webhook');
    }
    if (connection.kind !== WEBHOOK_KIND) throw notificationRefusal('no_webhook');
    return connection;
  }

  private subscriptionOf(connectionId: string): Subscription | undefined {
    return this.dependencies.subscriptionRows.ofConnection(connectionId)[0];
  }

  private subscriptionRequired(connectionId: string): Subscription {
    this.connectionOf(connectionId);
    const subscription = this.subscriptionOf(connectionId);
    if (subscription === undefined) throw notificationRefusal('no_webhook');
    return subscription;
  }

  private isWebhook(subscription: Subscription): boolean {
    try {
      return (
        this.dependencies.integrations.access.find(subscription.connectionId).kind === WEBHOOK_KIND
      );
    } catch {
      return false;
    }
  }

  private view(connection: Connection, subscription: Subscription): WebhookView {
    const secrets = this.dependencies.integrations.connections.view(connection).secrets;
    return {
      id: connection.id,
      name: connection.name,
      url: displayUrl(connection.params.url ?? ''),
      project: subscription.projectPath,
      events: subscription.events,
      enabled: connection.enabled,
      secret: secrets.every((one) => !one.required || one.present),
      disabledReason: connection.enabled ? null : subscription.disabledReason,
      failureStreak: subscription.failureStreak,
    };
  }

  private deliveryView(delivery: Delivery): WebhookDeliveryView {
    return {
      id: delivery.id,
      webhookId: `msg_${delivery.shortKey}`,
      type: webhookType(delivery.kind),
      run: delivery.run,
      group: delivery.group,
      state: delivery.state,
      attempts: this.dependencies.attempts.ofDelivery(delivery.id).map((one) => ({
        n: one.n,
        at: one.startedAt,
        statusCode: one.statusCode,
        error: one.errorKind,
        durationMs: one.durationMs,
        excerpt: one.excerpt,
      })),
      error: delivery.lastError,
      createdAt: delivery.createdAt,
    };
  }
}
