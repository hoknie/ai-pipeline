import type { Method, Request } from '../contract/index.ts';

import { auditHandlers, audited } from './audit/index.ts';
import { configHandlers } from './config.ts';
import { groupHandlers } from './groups.ts';
import { accessHandlers, guard } from './access/index.ts';
import { identityHandlers } from './identity/index.ts';
import { integrationHandlers, notificationHandlers } from './integrations/index.ts';
import { observerHandlers } from './observers.ts';
import { providerHandlers } from './providers.ts';
import { queueHandlers } from './queue.ts';
import { repositoryHandlers } from './repositories.ts';
import { runHandlers } from './runs.ts';
import { statsHandlers } from './stats.ts';
import { systemHandlers } from './system.ts';
import type { Handler, HandlerTable, IpcContext } from './types.ts';

/** Every method of the daemon and its handler. */
export const handlers: HandlerTable = {
  ...systemHandlers,
  ...repositoryHandlers,
  ...integrationHandlers,
  ...notificationHandlers,
  ...observerHandlers,
  ...configHandlers,
  ...providerHandlers,
  ...runHandlers,
  ...groupHandlers,
  ...queueHandlers,
  ...statsHandlers,
  ...identityHandlers,
  ...auditHandlers,
  ...accessHandlers,
};

/** Answers a request with the handler of its method; in server mode the journal records the calls that change something. */
export function handle(request: Request, context: IpcContext): Promise<unknown> {
  return audited(request, context, async () => {
    guard(request, context);
    const handler = handlers[request.method] as Handler<Method>;
    return handler(request.params as never, context);
  });
}
