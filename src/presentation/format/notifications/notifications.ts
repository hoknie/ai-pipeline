import type { ChannelStateView, DeliveryView, SubscriptionView } from '../../ipc/contract/index.ts';

import { type Style, plainStyle } from '../style.ts';
import { addedAt, oneLine, table } from '../table.ts';

/** The subscriptions: where they listen, for which events, whether they work. */
export function formatSubscriptions(
  subscriptions: readonly SubscriptionView[],
  style: Style = plainStyle,
): string {
  if (subscriptions.length === 0) return 'No notification subscriptions yet.';
  return table(
    [
      ['ID', 'CONNECTION', 'KIND', 'PROJECT', 'EVENTS', 'STATE'],
      ...subscriptions.map((one) => [
        style.argument(one.id),
        `${one.connectionName} (${one.connection})`,
        one.kind,
        one.project ?? 'all projects',
        one.events.join(', '),
        one.enabled ? 'enabled' : 'disabled',
      ]),
    ],
    style,
  );
}

/** The journal of sending, the newest first; the error is the safe text of the channel. */
export function formatDeliveries(
  deliveries: readonly DeliveryView[],
  style: Style = plainStyle,
): string {
  if (deliveries.length === 0) return 'No deliveries yet.';
  return table(
    [
      ['ID', 'WHEN', 'SUBSCRIPTION', 'EVENT', 'STATE', 'TRIES', 'ERROR'],
      ...deliveries.map((one) => [
        String(one.id),
        addedAt(one.createdAt),
        one.subscription,
        one.kind === 'test'
          ? 'test'
          : `${one.kind} ${one.run}${one.group === null ? '' : `/${one.group}`}`,
        one.state,
        String(one.attempts),
        one.error === null ? '' : oneLine(one.error),
      ]),
    ],
    style,
    { flex: 6 },
  );
}

/** The state of the channel of a connection in one phrase; empty when the connection has none. */
export function formatChannelState(channel: ChannelStateView | null): string {
  if (channel === null) return '—';
  return channel.state === 'listening' ? 'listening' : `error: ${channel.error ?? 'unknown'}`;
}
