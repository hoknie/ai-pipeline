import {
  decodeClosure,
  encodeClosure,
  type Closure,
  type Delivery,
  type NotificationEvent,
} from '../types/index.ts';

import { drawOf, publicUrlOf } from './drawing.ts';
import type { OutboxDependencies } from './outbox.ts';

/** What a run looked like when it changed: the events it holds and how its groups stand. */
export interface RunSnapshot {
  run: string;
  events: NotificationEvent[];
  groups: Map<
    string,
    { status: string; decisions: number; by: 'human' | 'autopilot' | 'observer' | null }
  >;
}

/** Closes the messages of questions that are no longer open and tells who closed them. */
export class QuestionCloser {
  private readonly dependencies: OutboxDependencies;

  constructor(dependencies: OutboxDependencies) {
    this.dependencies = dependencies;
  }

  /** Marks the question closed; true when a message in a chat has to be redrawn. */
  close(delivery: Delivery, snapshot: RunSnapshot): boolean {
    const { outcomes, publish, now } = this.dependencies;
    outcomes.markClosed(delivery.id, encodeClosure(this.closure(delivery, snapshot)), now());
    publish.journalChanged(delivery.id);
    return delivery.state === 'sent' && delivery.external !== null;
  }

  /** Draws the closed message again, in the chat it was sent to; a failure only gets logged. */
  async refresh(deliveryId: number): Promise<void> {
    const { deliveries, subscriptions, answers, channels, config, log } = this.dependencies;
    const delivery = deliveries.find(deliveryId);
    if (delivery?.external == null || delivery.state !== 'closed') return;
    const subscription = subscriptions.all().find((one) => one.id === delivery.subscriptionId);
    const opened = subscription && channels.open(subscription.connectionId);
    if (!opened) return;
    try {
      await opened.channel.update(
        delivery.external,
        drawOf(
          delivery,
          answers.all(delivery.id),
          decodeClosure(delivery.closedBy),
          opened,
          publicUrlOf(config),
        ),
        delivery.shortKey,
      );
    } catch (error) {
      log(`notifications: cannot close the message of delivery ${delivery.id}: ${String(error)}`);
    }
  }

  /** Who closed the question: the bot that answered, the decision recorded in the group, or the cancel. */
  private closure(delivery: Delivery, snapshot: RunSnapshot): Closure {
    const own = decodeClosure(delivery.closedBy);
    if (own.by === 'channel') return own;
    const sibling = this.dependencies.deliveries
      .ofEvent(delivery.eventKey)
      .map((other) => decodeClosure(other.closedBy))
      .find((closure) => closure.by === 'channel');
    if (sibling !== undefined) return sibling;
    const group = snapshot.groups.get(delivery.group ?? '');
    if (group === undefined || group.status === 'cancelled') return { by: 'cancelled' };
    if (group.decisions > delivery.payload.asked && group.by !== null) return { by: group.by };
    return { by: 'other' };
  }
}
