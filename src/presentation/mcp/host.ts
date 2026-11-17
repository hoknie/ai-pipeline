import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { hostKit, type HostOptions } from './host-kit.ts';
import { registerTaskLinks } from './host-links.ts';
import {
  registerAnswer,
  registerApply,
  registerCancel,
  registerGroup,
  registerMarkDelivered,
  registerProvider,
  registerRetry,
  registerRun,
  registerSkipStep,
  registerStatus,
  registerVariant,
} from './host-runs.ts';
import {
  registerQueue,
  registerQueueAdd,
  registerQueueEdit,
  registerQueueRemove,
  registerQueueStart,
} from './host-queue.ts';
import {
  registerQueueDismiss,
  registerQueueParallel,
  registerQueuePause,
  registerQueueReturn,
  registerQueueRunNow,
  registerQueueSettings,
  registerRunPause,
} from './host-queue-control.ts';

export type { HostOptions } from './host-kit.ts';

export function createHostServer(options: HostOptions): McpServer {
  const kit = hostKit(options);
  for (const register of [
    registerRun,
    registerStatus,
    registerGroup,
    registerCancel,
    registerRetry,
    registerSkipStep,
    registerVariant,
    registerProvider,
    registerAnswer,
    registerApply,
    registerMarkDelivered,
    registerQueue,
    registerQueueAdd,
    registerQueueEdit,
    registerQueueRemove,
    registerQueueStart,
    registerTaskLinks,
    registerQueueParallel,
    registerQueueSettings,
    registerQueuePause,
    registerQueueReturn,
    registerRunPause,
    registerQueueDismiss,
    registerQueueRunNow,
  ]) {
    register(kit);
  }
  return kit.server;
}
