import { AppError } from '../../../../platform/errors/index.ts';
import { isAdmin } from '../../../../feature/identity/types/index.ts';
import type { Method, Request } from '../../contract/index.ts';
import type { IpcContext } from '../types.ts';

type Predicate = (params: Record<string, unknown>) => boolean;

const always: Predicate = () => true;

/** `level` is `global`, and a missing `level` means `global` for the settings methods. */
const globalLevel: Predicate = (params) => (params.level ?? 'global') === 'global';

const explicitGlobal: Predicate = (params) => params.level === 'global';

const sharedRepository: Predicate = (params) => params.repository === null;

/**
 * Methods that only administrators call, and when: users, the paths of the server, the shared
 * level of the settings, the statistics. A method that writes shared files or paths of the server
 * belongs here.
 */
export const adminMethods: Partial<Record<Method, Predicate>> = {
  users_list: always,
  audit_list: always,
  users_set: always,
  users_disable: always,
  users_enable: always,
  login_link_create: always,
  repository_add: always,
  repository_update: always,
  repository_move: always,
  repository_remove: always,
  config_write: explicitGlobal,
  config_delete: explicitGlobal,
  config_setting: globalLevel,
  config_settings: globalLevel,
  config_mcp_server: globalLevel,
  specialist_tags_set: sharedRepository,
  specialist_tag_rename: sharedRepository,
  specialist_tag_remove: sharedRepository,
  specialists_import: always,
  pipelines_import: always,
  observers_set: always,
  stats_clear: always,
};

export const ACCESS_DENIED = 'access.denied';

function denied(message: string): AppError {
  return new AppError('forbidden', message, { code: 'ipc.guard', responseCode: ACCESS_DENIED });
}

/** The delivery mode of the run in effect; `null` when the run is unknown. */
function deliveryMode(request: Request, { services }: IpcContext): string | null {
  const runId = (request.params as { runId?: string }).runId;
  if (runId === undefined) return null;
  const state = services.runs.states.lookup(runId);
  return state ? state.run.config.delivery.mode : null;
}

/**
 * The rights before the access policies: in server mode a user who is not an administrator is
 * refused the administrator methods and a delivery outside a branch. The local and the system
 * actor pass.
 */
export function guard(request: Request, context: IpcContext): void {
  const { actor } = context;
  if (actor.kind !== 'user') return;
  const rule = adminMethods[request.method];
  if (rule?.(request.params as Record<string, unknown>) && !isAdmin(actor)) {
    throw denied(`${request.method} needs an administrator`);
  }
  if (request.method === 'apply') {
    const mode = deliveryMode(request, context);
    // An unknown run (mode === null) passes on purpose: `apply` itself fails on an unknown run.
    if (mode !== null && mode !== 'branch') {
      throw denied(
        `delivery.mode is \`${mode}\`: the server working tree is shared, so a user delivers by a branch (delivery.mode: branch)`,
      );
    }
  }
}
