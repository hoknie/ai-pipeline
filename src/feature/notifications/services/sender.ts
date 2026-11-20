import {
  ChannelFailure,
  emptyEventData,
  notificationRefusal,
  type Delivery,
  type DeliveryView,
} from '../types/index.ts';

import { drawOf, publicUrlOf } from './drawing.ts';
import type { OutboxDependencies } from './outbox.ts';
import { texts } from '../types/index.ts';
import { toView } from './journal.ts';

/** The pauses before the next attempt after a temporary refusal; the delivery fails after the last. */
export const RETRY_MS: readonly number[] = [5_000, 30_000, 120_000, 600_000, 1_800_000];

/** A delivery that did not get through in this time since it was made is given up on. */
export const GIVE_UP_MS = 3_600_000;

/** Sends the pending deliveries through their channels and decides what a refusal means. */
export class DeliverySender {
  private readonly dependencies: OutboxDependencies;
  /** The connections a channel asked to wait for, until when (ms). */
  private readonly waiting = new Map<string, number>();

  constructor(dependencies: OutboxDependencies) {
    this.dependencies = dependencies;
  }

  /** One attempt for a pending delivery; never throws. */
  async deliver(delivery: Delivery): Promise<void> {
    const { subscriptions, outcomes, channels, factories, config, publish, now } =
      this.dependencies;
    const subscription = subscriptions.all().find((one) => one.id === delivery.subscriptionId);
    if (subscription === undefined || !subscription.enabled) {
      outcomes.markClosed(delivery.id, 'subscription_off', now());
      publish.journalChanged(delivery.id);
      return;
    }
    const opened = channels.open(subscription.connectionId);
    if (opened === null) {
      this.fail(delivery, subscription.connectionId, unavailable('the connection is disabled'));
      return;
    }
    const missing = factories
      .get(opened.connection.kind)
      ?.missingForSubscription(opened.connection.params);
    if (missing !== null && missing !== undefined) {
      this.fail(delivery, opened.connection.id, permanentFailure(`${missing} is not set`));
      return;
    }
    const until = this.waiting.get(opened.connection.id) ?? 0;
    if (until > now()) {
      outcomes.markRetry(delivery.id, delivery.attempts, until, delivery.lastError ?? '', now());
      return;
    }
    try {
      const ref = await opened.channel.send(
        drawOf(delivery, [], null, opened, publicUrlOf(config)),
        delivery.shortKey,
      );
      outcomes.markSent(delivery.id, ref, delivery.attempts + 1, now());
      publish.journalChanged(delivery.id);
    } catch (error) {
      this.fail(delivery, opened.connection.id, error);
    }
  }

  /** Sends a test message through a subscription and records it in the journal. */
  async test(subscriptionId: string): Promise<DeliveryView> {
    const { subscriptions, deliveries, outcomes, channels, publish, now } = this.dependencies;
    const subscription = subscriptions.find(subscriptionId);
    const opened = channels.open(subscription.connectionId);
    if (opened === null) throw notificationRefusal('connection_disabled');
    const delivery = deliveries.claim(
      {
        subscriptionId,
        eventKey: `test/${now()}/${Math.random().toString(36).slice(2, 10)}`,
        kind: 'test',
        run: '-',
        group: null,
        questionKey: null,
        payload: emptyEventData(),
      },
      now(),
    );
    if (delivery === null) throw notificationRefusal('channel_failed');
    try {
      const ref = await opened.channel.sendText(texts(opened.language).test);
      outcomes.markSent(delivery.id, ref, 1, now());
    } catch (error) {
      const failure = safeFailure(error);
      outcomes.markFailed(delivery.id, 1, failure.message, now());
      publish.journalChanged(delivery.id);
      throw notificationRefusal('channel_failed', failure.message);
    }
    publish.journalChanged(delivery.id);
    return toView(deliveries.find(delivery.id)!);
  }

  /** What a refusal of the channel means: wait and try again, or give up. */
  private fail(delivery: Delivery, connectionId: string, error: unknown): void {
    const { outcomes, publish, now, log } = this.dependencies;
    const failure = safeFailure(error);
    if (!(error instanceof ChannelFailure))
      log(`notifications: delivery ${delivery.id}: ${String(error)}`);
    const attempts = delivery.attempts + 1;
    const at = now();
    if (failure.retryAfterMs !== null) this.waiting.set(connectionId, at + failure.retryAfterMs);
    const delay = failure.retryAfterMs ?? RETRY_MS[attempts - 1];
    if (failure.permanent || delay === undefined || delivery.createdAt + GIVE_UP_MS <= at + delay) {
      outcomes.markFailed(delivery.id, attempts, failure.message, at);
    } else {
      outcomes.markRetry(delivery.id, attempts, at + delay, failure.message, at);
    }
    publish.journalChanged(delivery.id);
  }
}

function unavailable(message: string): ChannelFailure {
  return new ChannelFailure(message, { permanent: false });
}

function permanentFailure(message: string): ChannelFailure {
  return new ChannelFailure(message, { permanent: true });
}

/** A failure whose text is safe to show: the channel's own, or a fixed one for anything else. */
function safeFailure(error: unknown): ChannelFailure {
  return error instanceof ChannelFailure
    ? error
    : new ChannelFailure('unexpected channel error', { permanent: false });
}
