import type { Method, Request } from '../contract/index.ts';

import { configHandlers } from './config.ts';
import { groupHandlers } from './groups.ts';
import { observerHandlers } from './observers.ts';
import { queueHandlers } from './queue.ts';
import { repositoryHandlers } from './repositories.ts';
import { runHandlers } from './runs.ts';
import { systemHandlers } from './system.ts';
import type { Handler, HandlerTable, IpcContext } from './types.ts';

/** Every method of the daemon and its handler. */
export const handlers: HandlerTable = {
  ...systemHandlers,
  ...repositoryHandlers,
  ...observerHandlers,
  ...configHandlers,
  ...runHandlers,
  ...groupHandlers,
  ...queueHandlers,
};

/** Answers a request with the handler of its method. */
export function handle(request: Request, context: IpcContext): Promise<unknown> {
  const handler = handlers[request.method] as Handler<Method>;
  return handler(request.params as never, context);
}
