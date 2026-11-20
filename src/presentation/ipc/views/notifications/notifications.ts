import type { ChannelStatus } from '../../../../feature/notifications/types/index.ts';
import type { ChannelStateView } from '../../contract/index.ts';

/** The state of a channel as the clients see it: a safe text only. */
export function channelView(status: ChannelStatus, connection = ''): ChannelStateView {
  return status.state === 'listening'
    ? { connection, state: 'listening', error: null, unauthorized: false }
    : { connection, state: 'error', error: status.error, unauthorized: status.unauthorized };
}
