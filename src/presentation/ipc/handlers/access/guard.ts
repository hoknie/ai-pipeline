import { AppError, notFound } from '../../../../platform/errors/index.ts';
import type { Request } from '../../contract/index.ts';
import type { IpcContext } from '../types.ts';
import { methodActions } from './method-actions.ts';
import type { Params, Target } from './resource.ts';

export const ACCESS_DENIED = 'access.denied';

/** The refusal of the rights: the action and the project are in the text of the answer. */
export function accessDenied(action: string, project: string | null): AppError {
  const where = project === null ? '' : ` in project \`${project}\``;
  return new AppError('forbidden', `access denied: ${action}${where}`, {
    code: 'ipc.guard',
    responseCode: ACCESS_DENIED,
  });
}

function checkTarget(action: string, target: Target, context: IpcContext): void {
  const { access } = context.services;
  const { actor } = context;
  if (target.anywhere) {
    const reachable =
      access.can(actor, action, {}) ||
      context.services.registry
        .entries()
        .some((entry) => access.can(actor, action, { repository: entry.path }));
    if (!reachable) throw accessDenied(action, null);
    return;
  }
  for (const resource of target.resources) {
    const project = resource.repository ?? null;
    // a run or a task of a project the actor cannot read is not there for the actor
    if (target.hides !== undefined && project !== null) {
      if (!access.can(actor, 'project.read', { repository: project })) {
        throw notFound('ipc.guard', target.hides);
      }
    }
    if (!access.can(actor, action, resource)) {
      const slug =
        project === null ? null : (context.services.registry.entry(project)?.slug ?? project);
      throw accessDenied(action, slug);
    }
  }
}

/**
 * The rights of a request: in server mode a user is refused what the policies refuse, before the
 * method runs. The local and the system actor pass.
 */
export function guard(request: Request, context: IpcContext): void {
  const { actor } = context;
  if (actor.kind !== 'user') return;
  const entry = methodActions[request.method];
  const params = request.params as Params;
  const action = typeof entry.action === 'function' ? entry.action(params) : entry.action;
  if (action !== null) {
    const target = entry.target ? entry.target(params, context) : { resources: [{}] };
    checkTarget(action, target, context);
    for (const extra of entry.also ?? []) {
      checkTarget(extra.action, extra.target(params, context), context);
    }
  }
}
