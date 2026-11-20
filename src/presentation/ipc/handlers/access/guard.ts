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

/** The delivery mode of the run in effect; `null` when the run is unknown. */
function deliveryMode(request: Request, { services }: IpcContext): string | null {
  const runId = (request.params as { runId?: string }).runId;
  if (runId === undefined) return null;
  const state = services.runs.states.lookup(runId);
  return state ? state.run.config.delivery.mode : null;
}

/** The refusal of a delivery outside a branch: the working tree of the server is shared. */
function checkDelivery(request: Request, context: IpcContext): void {
  if (request.method !== 'apply') return;
  const mode = deliveryMode(request, context);
  // An unknown run (mode === null) passes on purpose: `apply` itself fails on an unknown run.
  if (mode !== null && mode !== 'branch') {
    throw new AppError(
      'forbidden',
      `delivery.mode is \`${mode}\`: the server working tree is shared, so a user delivers by a branch (delivery.mode: branch)`,
      { code: 'ipc.guard', responseCode: ACCESS_DENIED },
    );
  }
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
 * method runs. The local and the system actor pass. The delivery of a user only by a branch
 * stays: it protects the shared working tree of the server, whatever the policies say.
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
  checkDelivery(request, context);
}
