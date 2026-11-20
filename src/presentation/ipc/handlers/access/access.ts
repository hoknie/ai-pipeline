import { notFound, rejected } from '../../../../platform/errors/index.ts';
import type { Resource } from '../../../../feature/access/types/index.ts';
import {
  isAction,
  similarActions,
  withDefaultRole,
} from '../../../../feature/access/types/index.ts';
import type { AccessActionsView, AccessCheckView, AccessMeView } from '../../contract/index.ts';
import { serverSettings } from '../identity/identity.ts';
import type { HandlerTable, IpcContext } from '../types.ts';
import { run } from './resource.ts';

/** The resource a check is about: the run with its attributes, or a project. */
function checked(params: { repository?: string; run?: string }, context: IpcContext): Resource {
  if (params.run !== undefined) {
    const { resources } = run({ runId: params.run }, context);
    const [found] = resources;
    if (!found) throw notFound('access.run', `unknown run \`${params.run}\``);
    return found;
  }
  return params.repository === undefined ? {} : { repository: params.repository };
}

/** The rights: who may do what, and the explanation of a decision. */
export const accessHandlers = {
  access_check: async (params, context): Promise<AccessCheckView> => {
    const { access, identity, registry } = context.services;
    const user = identity.users.byEmail(params.user);
    if (!user) throw notFound('identity.user_not_found', `no user ${params.user}`);
    if (!isAction(params.action)) {
      const similar = similarActions(params.action).join(', ');
      throw rejected(`unknown action \`${params.action}\`; similar: ${similar}`);
    }
    const resource = checked(params, context);
    const decision = access.decide(user.id, user.attributes, params.action, resource);
    const slug =
      resource.repository == null
        ? null
        : (registry.entry(resource.repository)?.slug ?? resource.repository);
    return {
      user: {
        id: user.id,
        email: user.email,
        attributes: withDefaultRole(user.attributes, serverSettings(context).defaultRole),
      },
      action: params.action,
      decision: decision.effect,
      reason: decision.reason,
      matched: decision.matched,
      resource: {
        repository: slug,
        author: resource.author ?? null,
        pipeline: resource.pipeline ?? null,
        tags: resource.tags ?? [],
      },
    };
  },
  access_me: async (params, context): Promise<AccessMeView> => {
    const { access, registry } = context.services;
    const { actor } = context;
    const repository =
      params.repository === undefined
        ? null
        : await registry.resolve(params.repository).catch(() => params.repository ?? null);
    const readable = access.readableRepositories(actor);
    return {
      actor: actor.kind,
      userId: actor.kind === 'user' ? actor.user.id : null,
      repository: params.repository ?? null,
      ...access.allowedActions(actor, repository),
      repositories: readable.all
        ? null
        : registry
            .entries()
            .filter((entry) => readable.has(entry.path))
            .map((entry) => entry.path),
    };
  },
  access_actions: async (_params, { services }): Promise<AccessActionsView> => ({
    actions: services.access.catalog().map((action) => ({ ...action })),
  }),
} satisfies Partial<HandlerTable>;
