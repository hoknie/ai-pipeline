import type { Method } from '../../contract/index.ts';
import type { IpcContext } from '../types.ts';
import { runMethods } from './method-runs.ts';
import { settingsMethods } from './method-settings.ts';
import type { Params, Target } from './resource.ts';

/** What the rights say about one method of the daemon. */
export interface MethodAccess {
  /**
   * The action of the catalog, by the parameters when the level or the project decides; `null`:
   * no check, the call is of the account of the user itself, of a worker or of the sign-in.
   */
  action: string | null | ((params: Params) => string);
  /** What the call is done to; the shared level when there is none. */
  target?: (params: Params, context: IpcContext) => Target;
  /** Further checks of the same call: what the call turns its target into must pass too. */
  also?: { action: string; target: (params: Params, context: IpcContext) => Target }[];
}

/** Every method of the contract and the action it needs. A missing method is a compile error. */
export const methodActions: Record<Method, MethodAccess> = {
  ...runMethods,
  ...settingsMethods,
};

/** The action of a call. */
export function actionOf(method: Method, params: Params): string | null {
  const { action } = methodActions[method];
  return typeof action === 'function' ? action(params) : action;
}
