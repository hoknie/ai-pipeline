import type { DeliveryRepository } from '../repositories/index.ts';
import type { Delivery, DeliveryState, DeliveryView } from '../types/index.ts';

export function toView(delivery: Delivery): DeliveryView {
  return {
    id: delivery.id,
    subscription: delivery.subscriptionId,
    event: delivery.eventKey,
    kind: delivery.kind,
    run: delivery.run,
    group: delivery.group,
    state: delivery.state,
    attempts: delivery.attempts,
    lastAttemptAt: delivery.updatedAt,
    error: delivery.lastError,
    createdAt: delivery.createdAt,
  };
}

export const JOURNAL_LIMIT = 200;

/** The journal of deliveries: newest first, with only what is safe to show. */
export class JournalService {
  private readonly deliveries: DeliveryRepository;
  private readonly hidden: () => readonly string[];

  /** `hidden`: the subscriptions whose deliveries have a journal of their own (webhooks). */
  constructor(deliveries: DeliveryRepository, hidden: () => readonly string[] = () => []) {
    this.deliveries = deliveries;
    this.hidden = hidden;
  }

  list(filter: {
    subscription?: string | undefined;
    state?: DeliveryState | undefined;
    limit?: number | undefined;
  }): DeliveryView[] {
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), JOURNAL_LIMIT);
    return this.deliveries
      .journal({
        subscription: filter.subscription,
        exclude: this.hidden(),
        state: filter.state,
        limit,
      })
      .map(toView);
  }
}
