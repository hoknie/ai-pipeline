import { z } from 'zod';

import { parseBody } from '../../http.ts';
import type { ParamsOf } from '../../../ipc/contract/index.ts';
import type { Route, RouteKit } from '../types.ts';

const id = z.string().min(1).max(64);
const names = z.array(z.string().min(1).max(40)).max(20);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const webhookId = strict({ id });
const addWebhook = strict({
  name: z.string().min(1).max(64),
  url: z.string().min(1).max(2048),
  repository: z.string().min(1).max(4096).optional(),
  allProjects: z.boolean().optional(),
  events: names.optional(),
});
const editWebhook = strict({
  id,
  url: z.string().min(1).max(2048).optional(),
  events: names.optional(),
});
const redeliver = strict({ id: z.number().int().min(1) });

const webhookActions = [
  ['enable', 'webhook_enable'],
  ['disable', 'webhook_disable'],
  ['remove', 'webhook_remove'],
  ['test', 'webhook_test'],
] as const;

/**
 * The routes of webhooks: made, switched, tested and read from the panel. Their secret is set with
 * the local CLI only, and no route takes or returns it.
 */
export function webhooksRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/webhooks$/,
      handle: async () => call('webhook_list', {}),
    },
    {
      method: 'POST',
      pattern: /^\/api\/webhooks$/,
      handle: async (_match, body) => call('webhook_add', parseBody(addWebhook, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/webhooks\/edit$/,
      handle: async (_match, body) => call('webhook_edit', parseBody(editWebhook, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/webhooks\/redeliver$/,
      handle: async (_match, body) => call('webhook_redeliver', parseBody(redeliver, body)),
    },
    ...webhookActions.map(([verb, method]): Route => ({
      method: 'POST',
      pattern: new RegExp(`^/api/webhooks/${verb}$`),
      handle: async (_match, body) => call(method, parseBody(webhookId, body)),
    })),
    {
      method: 'GET',
      pattern: /^\/api\/webhooks\/log$/,
      handle: async (_match, _body, _repository, query) => {
        const state = query.get('state') ?? undefined;
        const limit = query.get('limit') ?? undefined;
        const params: ParamsOf<'webhook_log'> = {
          id: query.get('id') ?? '',
          ...(state === undefined ? {} : { state }),
          ...(limit === undefined ? {} : { limit: Number(limit) }),
        };
        return call('webhook_log', params);
      },
    },
  ];
}
