import { z } from 'zod';

import { parseBody } from '../../http.ts';
import type { ParamsOf } from '../../../ipc/contract/index.ts';
import type { Route, RouteKit } from '../types.ts';

const id = z.string().min(1).max(64);
const names = z.array(z.string().min(1).max(40)).max(20);
/** Strict: a field that is not listed (a secret, say) is refused by name, never stored or echoed. */
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const addConnection = strict({
  kind: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  repository: z.string().min(1).max(4096).optional(),
  global: z.boolean().optional(),
  params: z.record(z.string().min(1).max(64), z.string().max(1000)).optional(),
});
const connectionId = strict({ id });
const connectionActions = [
  ['enable', 'integration_enable'],
  ['disable', 'integration_disable'],
  ['remove', 'integration_remove'],
  ['check', 'integration_check'],
] as const;

const editConnection = strict({
  id,
  set: z.record(z.string().min(1).max(64), z.string().max(1000)).optional(),
  unset: z.array(z.string().min(1).max(64)).max(50).optional(),
});
/** The link of a project to a service registry: exactly one of path, auto and clear. */
const linkProject = strict({
  id: z.string().min(1).max(80),
  repository: z.string().min(1).max(4096),
  path: z.string().min(1).max(512).optional(),
  auto: z.literal(true).optional(),
  clear: z.literal(true).optional(),
}).refine(
  (body) => [body.path, body.auto, body.clear].filter((one) => one !== undefined).length === 1,
  { message: 'pass exactly one of path, auto and clear' },
);
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

/** Makes a connection and switches, checks or removes one: none of these carries a secret. */
function connectionRoutes(call: RouteKit['call']): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/api\/integrations$/,
      handle: async (_match, body) => call('integration_add', parseBody(addConnection, body)),
    },
    ...connectionActions.map(([verb, method]): Route => ({
      method: 'POST',
      pattern: new RegExp(`^/api/integrations/${verb}$`),
      handle: async (_match, body) => call(method, parseBody(connectionId, body)),
    })),
  ];
}

/**
 * The pages of integrations: connections (make, enable, disable, check, remove and edit their
 * non-secret parameters), subscriptions, the journal and the state of the channels. No route takes
 * or returns a secret: setting and removing one stays with the local CLI. The link of a project
 * to its project in a service registry is a setting of the project and goes through here.
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
      // The skills of the registry of the current project, for the hints of the specialist form.
      method: 'GET',
      pattern: /^\/api\/integrations\/skills$/,
      handle: async (_match, _body, repository, query) =>
        call('integration_skills', {
          repository,
          ...(query.get('query') ? { query: query.get('query')!.slice(0, 200) } : {}),
        }),
    },
    ...connectionRoutes(call),
    {
      method: 'POST',
      pattern: /^\/api\/integrations\/edit$/,
      handle: async (_match, body) => call('integration_edit', parseBody(editConnection, body)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/integrations\/links$/,
      handle: async (_match, _body, _repository, query) => {
        const repository = query.get('repository') ?? undefined;
        return call('integration_links', repository === undefined ? {} : { repository });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/integrations\/link$/,
      handle: async (_match, body) => call('integration_link', parseBody(linkProject, body)),
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
