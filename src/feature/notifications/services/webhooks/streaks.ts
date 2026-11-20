import type { IntegrationsServices } from '../../../integrations/services/index.ts';
import type { NotificationsPublishPort } from '../../ports/index.ts';
import type { SubscriptionRepository } from '../../repositories/index.ts';
import type { ChannelFailure, RetryPolicy } from '../../types/index.ts';

export interface StreakDependencies {
  subscriptions: SubscriptionRepository;
  integrations: IntegrationsServices;
  publish: NotificationsPublishPort;
}

/**
 * Failed deliveries in a row, per subscription: a delivery that got through starts the count again,
 * and a connection that has had enough, or whose receiver is gone, is switched off with the reason.
 */
export class FailureStreaks {
  private readonly dependencies: StreakDependencies;

  constructor(dependencies: StreakDependencies) {
    this.dependencies = dependencies;
  }

  /** A delivery got through. */
  delivered(id: string): void {
    const { subscriptions } = this.dependencies;
    const subscription = subscriptions.find(id);
    if (subscription !== undefined && subscription.failureStreak > 0) {
      subscriptions.setFailures(id, 0, null);
    }
  }

  /** A delivery failed for good. */
  failedForGood(id: string, policy: RetryPolicy, failure: ChannelFailure): void {
    const { subscriptions, integrations, publish } = this.dependencies;
    const subscription = subscriptions.find(id);
    if (subscription === undefined) return;
    if (policy.disableAfterFailures === null && !failure.disable) return;
    const streak = subscriptions.addFailure(id);
    const reason = failure.disable
      ? 'the receiver answered 410 Gone'
      : policy.disableAfterFailures !== null && streak >= policy.disableAfterFailures
        ? `${streak} deliveries failed in a row`
        : null;
    if (reason === null) return;
    subscriptions.setFailures(id, streak, reason);
    try {
      integrations.connections.disable(subscription.connectionId);
    } catch {
      // the connection is gone already: nothing is left to switch off
    }
    publish.subscriptionsChanged();
  }
}
