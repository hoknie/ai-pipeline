import { z } from 'zod';

import { parseBody } from '../../http.ts';
import type { ParamsOf } from '../../../ipc/contract/index.ts';
import type { Route, RouteKit } from '../types.ts';

const id = z.string().min(1).max(64);
const names = z.array(z.string().min(1).max(40)).max(20);
/** Strict: a field that is not listed (a secret, say) is refused by name, never stored or echoed. */
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const editConnection = strict({
  id,
  set: z.record(z.string().min(1).max(64), z.string().max(1000)).optional(),
  unset: z.array(z.string().min(1).max(64)).max(50).optional(),
});
const addSubscription = strict({
  connection: id,
  repository: z.string().min(1).max(4096).optional(),
  allProjects: z.boolean().optional(),
  events: names.optional(),
});
const editSubscription = strict({ id, events: names });
const subscriptionId = strict({ id });

const subscriptionActions = [
  ['enable', 'notify_enable'],
  ['disable', 'notify_disable'],
  ['remove', 'notify_remove'],
  ['test', 'notify_test'],
] as const;

/**
 * The pages of integrations: connections (read, and their non-secret parameters), subscriptions,
 * the journal and the state of the channels. No route takes or returns a secret, and none creates,
 * removes, enables or disables a connection: that stays with the local CLI.
 */
export function integrationsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/integrations$/,
      handle: async () => ({
        connections: await call('integration_list', {}),
        types: await call('integration_types', {}),
        subscriptions: await call('notify_list', {}),
        channels: await call('notify_channels', {}),
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/integrations\/edit$/,
      handle: async (_match, body) => call('integration_edit', parseBody(editConnection, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/notifications$/,
      handle: async (_match, body) => call('notify_add', parseBody(addSubscription, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/notifications\/edit$/,
      handle: async (_match, body) => call('notify_edit', parseBody(editSubscription, body)),
    },
    ...subscriptionActions.map(([verb, method]): Route => ({
      method: 'POST',
      pattern: new RegExp(`^/api/notifications/${verb}$`),
      handle: async (_match, body) => call(method, parseBody(subscriptionId, body)),
    })),
    {
      method: 'GET',
      pattern: /^\/api\/notifications\/log$/,
      handle: async (_match, _body, _repository, query) => {
        const subscription = query.get('subscription') ?? undefined;
        const state = query.get('state') ?? undefined;
        const limit = query.get('limit') ?? undefined;
        const params: ParamsOf<'notify_log'> = {
          ...(subscription === undefined ? {} : { subscription }),
          ...(state === undefined ? {} : { state }),
          ...(limit === undefined ? {} : { limit: Number(limit) }),
        };
        return call('notify_log', params);
      },
    },
  ];
}
