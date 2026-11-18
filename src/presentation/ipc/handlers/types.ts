import type { BuildInfo } from '../../../platform/build/index.ts';
import type { Actor } from '../../../feature/identity/types/index.ts';
import type { Method, PanelControl, ParamsOf } from '../contract/index.ts';
import type { DaemonServices } from '../services.ts';
import type { Snapshots } from '../snapshots.ts';

/** What a handler works with: the services, the views and the daemon itself. */
export interface IpcContext {
  services: DaemonServices;
  snapshots: Snapshots;
  build: BuildInfo;
  /** Serves `web_status`, `web_start` and `web_stop`; without it the daemon refuses them. */
  panel: PanelControl | undefined;
  /** Who makes the request: `local`, `system` or a user (set by the application). */
  actor: Actor;
}

/** The handler of one method: one change of one service, then the answer through the views. */
export type Handler<M extends Method> = (
  params: ParamsOf<M>,
  context: IpcContext,
) => Promise<unknown>;

/** A handler for every method; a missing one is a compile error. */
export type HandlerTable = { [M in Method]: Handler<M> };
