import { failureCode, refusal } from '../../../../feature/integrations/types/index.ts';
import {
  isDeliveryState,
  notificationFailureCode,
  notificationRefusal,
} from '../../../../feature/notifications/types/index.ts';
import { channelView } from '../../views/index.ts';

import type { HandlerTable } from '../types.ts';

/**
 * Every failure of these handlers leaves as one of the fixed refusals of the notifications or of
 * the integrations: an error of a channel or of the database never carries a token or a path.
 */
async function guarded<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw failureCode(error) === null && notificationFailureCode(error) === null
      ? refusal('internal')
      : error;
  }
}

/** Subscriptions to notifications, their journal and the state of the channels. */
export const notificationHandlers = {
  notify_list: (params, { services }) =>
    guarded(() => services.notifications.subscriptions.list(params.repository)),
  notify_add: (params, { services }) =>
    guarded(() => services.notifications.subscriptions.add(params)),
  notify_edit: (params, { services }) =>
    guarded(() => services.notifications.subscriptions.edit(params.id, params.events)),
  notify_enable: (params, { services }) =>
    guarded(() => services.notifications.subscriptions.enable(params.id)),
  notify_disable: (params, { services }) =>
    guarded(() => services.notifications.subscriptions.disable(params.id)),
  notify_remove: (params, { services }) =>
    guarded(() => {
      services.notifications.subscriptions.remove(params.id);
      return Promise.resolve({ removed: params.id });
    }),
  notify_test: (params, { services }) =>
    guarded(() => services.notifications.dispatcher.test(params.id)),
  notify_log: (params, { services }) =>
    guarded(() => {
      if (params.state !== undefined && !isDeliveryState(params.state)) {
        throw notificationRefusal('not_found');
      }
      return Promise.resolve(
        services.notifications.journal.list({
          subscription: params.subscription,
          state:
            params.state === undefined || !isDeliveryState(params.state) ? undefined : params.state,
          limit: params.limit,
        }),
      );
    }),
  notify_channels: async (_params, { services }) =>
    guarded(async () => {
      const connections = await services.integrations.connections.list();
      return connections.flatMap((connection) => {
        const status = services.notifications.channels.statusOf(connection.id);
        return status === null ? [] : [channelView(status, connection.id)];
      });
    }),
} satisfies Partial<HandlerTable>;
