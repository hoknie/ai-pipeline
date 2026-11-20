import {
  isDeliveryState,
  notificationRefusal,
} from '../../../../feature/notifications/types/index.ts';

import { webhookView } from '../../views/index.ts';
import { guarded } from './notifications.ts';
import type { HandlerTable } from '../types.ts';

/** Outgoing webhooks: the connection and its one subscription as a single thing, and its journal. */
export const webhookHandlers = {
  webhook_list: (params, { services }) =>
    guarded(async () =>
      (await services.notifications.webhooks.list(params.repository)).map(webhookView),
    ),
  webhook_add: (params, { services }) =>
    guarded(async () => webhookView(await services.notifications.webhooks.add(params))),
  webhook_edit: (params, { services }) =>
    guarded(async () =>
      webhookView(
        await services.notifications.webhooks.edit(params.id, {
          url: params.url,
          events: params.events,
        }),
      ),
    ),
  webhook_enable: (params, { services }) =>
    guarded(async () => webhookView(await services.notifications.webhooks.enable(params.id))),
  webhook_disable: (params, { services }) =>
    guarded(async () => webhookView(await services.notifications.webhooks.disable(params.id))),
  webhook_remove: (params, { services }) =>
    guarded(async () => {
      await services.notifications.webhooks.remove(params.id);
      return { removed: params.id };
    }),
  webhook_test: (params, { services }) =>
    guarded(() => services.notifications.webhooks.test(params.id)),
  webhook_log: (params, { services }) =>
    guarded(() => {
      if (params.state !== undefined && !isDeliveryState(params.state)) {
        throw notificationRefusal('not_found');
      }
      return Promise.resolve(
        services.notifications.webhooks.log(params.id, {
          state:
            params.state === undefined || !isDeliveryState(params.state) ? undefined : params.state,
          limit: params.limit,
        }),
      );
    }),
  webhook_redeliver: (params, { services }) =>
    guarded(() => Promise.resolve(services.notifications.webhooks.redeliver(params.id))),
} satisfies Partial<HandlerTable>;
