import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerQueueAdd, registerRepair, registerSplit } from './worker-extra.ts';
import { registerRunShow } from './worker-read.ts';
import { registerArtifact, registerReport, workerKit, type WorkerOptions } from './worker-tools.ts';

export type { WorkerOptions } from './worker-tools.ts';

export function createWorkerServer(options: WorkerOptions): McpServer {
  const kit = workerKit(options);
  registerReport(kit);
  registerArtifact(kit);
  registerRunShow(kit);
  registerSplit(kit);
  registerQueueAdd(kit);
  registerRepair(kit);
  return kit.server;
}
