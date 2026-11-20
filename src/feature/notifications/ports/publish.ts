import type { ChannelStatus } from '../types/index.ts';

/** The panel hears about the subscriptions, the journal and the state of the channels. */
export interface NotificationsPublishPort {
  subscriptionsChanged(): void;
  journalChanged(delivery: number): void;
  channelChanged(connectionId: string, status: ChannelStatus | null): void;
}
