import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { hostKit, type HostOptions } from './host-kit.ts';
import {
  registerAnswer,
  registerApply,
  registerCancel,
  registerGroup,
  registerMarkDelivered,
  registerRetry,
  registerRun,
  registerSkipStep,
  registerStatus,
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
    registerAnswer,
    registerApply,
    registerMarkDelivered,
    registerQueue,
    registerQueueAdd,
    registerQueueEdit,
    registerQueueRemove,
    registerQueueStart,
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
