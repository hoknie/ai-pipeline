import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { packageVersion } from '../../platform/build/index.ts';
import { formatQueue, formatRun } from '../format/index.ts';
import type { QueueView, RunView } from '../ipc/contract/index.ts';
import type { Send } from './tools.ts';

export interface HostOptions {
  send: Send;
  cwd: string;
  now?: () => number;
}

export function withData(text: string, data: unknown): string {
  return `${text}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

export function hostKit(options: HostOptions) {
  const now = options.now ?? Date.now;
  const server = new McpServer({ name: 'aip', version: packageVersion() });
  const runId = z.string().describe('Run id from swarm_run or swarm_status');
  const tags = z
    .array(z.string())
    .optional()
    .describe('Names of existing tags; an unknown name is an error. Edit replaces the whole list');
  const parent = z
    .union([z.string(), z.number().int().positive()])
    .optional()
    .describe(
      'Run id or task number of this repository (161 or #161): the task gets the linked task tag of that run, first',
    );
  const skip = z
    .array(z.string())
    .optional()
    .describe(
      'Ids of pipeline steps this task skips, e.g. ["review", "qa"]. Edit replaces the whole list; [] runs every step',
    );
  const after = z
    .array(z.string())
    .optional()
    .describe(
      'Ids of queue items or runs of the repository that must be done (finished, merged and delivered) first. Edit replaces the whole list; [] removes the dependencies',
    );
  const group = z.string().describe('Group slug from swarm_status; `_split` for the split step');
  const showRun = async (method: string, params: Record<string, unknown>) => {
    const view = (await options.send(method, params)) as RunView;
    return withData(formatRun(view, now()), view);
  };
  const repo = z.string().optional().describe('Repository path; defaults to the current directory');
  const item = z.string().describe('Queue item id from swarm_queue');
  const queueGroups = z
    .array(z.object({ title: z.string(), task: z.string() }))
    .describe('Explicit groups');
  const showQueue = async (method: string, params: Record<string, unknown>, where?: string) => {
    const view = (await options.send(method, {
      repository: where ?? options.cwd,
      ...params,
    })) as QueueView & { item?: string };
    const text = formatQueue(view);
    return withData(view.item ? `Added item ${view.item}.\n${text}` : text, view);
  };
  return {
    options,
    now,
    server,
    runId,
    tags,
    parent,
    skip,
    after,
    group,
    showRun,
    repo,
    item,
    queueGroups,
    showQueue,
  };
}

export type HostKit = ReturnType<typeof hostKit>;
