import { z } from 'zod';

import { DELIVERY_MODES } from '../../feature/swarm-config/types/index.ts';
import { FEEDBACK_LIMIT } from '../../feature/runs/types/index.ts';
import { RUN_TITLE_LIMIT, WORKER_TOOLS } from '../../feature/agents/types/index.ts';
import { invalid } from '../../platform/errors/index.ts';
import { attempt } from './tools.ts';
import type { WorkerKit } from './worker-tools.ts';

export function registerSplit(kit: WorkerKit): void {
  const { options, server } = kit;
  if (options.split) {
    server.registerTool(
      WORKER_TOOLS.split,
      {
        title: 'Propose groups of work',
        description:
          'Propose how to split the task into independent groups. Each group gets a short title and a self-contained task. Calling again replaces the previous proposal. Then call swarm_report with verdict "done".',
        inputSchema: {
          groups: z
            .array(z.object({ title: z.string().min(1), task: z.string().min(1) }))
            .min(1)
            .describe('Groups of work, each with a title and a task'),
        },
      },
      ({ groups }) =>
        attempt(async () => {
          await options.send('split', { token: options.token, groups });
          return `Recorded ${groups.length} group(s). Call swarm_report when you are done.`;
        }),
    );
  }
}

export function registerQueueAdd(kit: WorkerKit): void {
  const { options, server } = kit;
  if (options.queue) {
    server.registerTool(
      WORKER_TOOLS.queue,
      {
        title: 'Add a task to the queue',
        description:
          'Put a task at the end of the queue of the repository this run belongs to, to be started later as its own run. Pass either task or groups; pass after with ids returned by earlier calls to order dependent tasks. The answer contains the id of the new item. It does not start the queue. Call swarm_report afterwards as usual.',
        inputSchema: {
          pipeline: z.string().min(1).describe('Pipeline id of the configuration, e.g. feature'),
          task: z.string().trim().min(1).optional().describe('One task text'),
          groups: z
            .array(z.object({ title: z.string().trim().min(1), task: z.string().trim().min(1) }))
            .min(1)
            .optional()
            .describe('Explicit groups instead of task'),
          title: z
            .string()
            .trim()
            .min(1)
            .max(RUN_TITLE_LIMIT)
            .optional()
            .describe(`Title of the run, at most ${RUN_TITLE_LIMIT} characters`),
          autoDeliver: z
            .boolean()
            .optional()
            .describe('Deliver merged groups automatically; omit to follow delivery.auto'),
          deliveryMode: z
            .enum(DELIVERY_MODES)
            .optional()
            .describe('worktree, commit or branch; omit to follow delivery.mode'),
          variant: z
            .string()
            .optional()
            .describe('Id of a variant of the pipeline; omit for `default`, the pipeline as it is'),
          skip: z
            .array(z.string())
            .optional()
            .describe('Ids of pipeline steps this task skips, e.g. ["review", "qa"]'),
          after: z
            .array(z.string().min(1))
            .optional()
            .describe(
              'Ids of queue items or runs that must be done first, e.g. the ids returned by earlier swarm_queue_add calls',
            ),
        },
      },
      ({ pipeline, variant, task, groups, title, autoDeliver, deliveryMode, skip, after }) =>
        attempt(async () => {
          if ((task === undefined) === (groups === undefined)) {
            throw invalid('mcp.invalid_arguments', 'pass either task or groups');
          }
          const result = (await options.send('worker_queue_add', {
            token: options.token,
            pipeline,
            ...(variant !== undefined ? { variant } : {}),
            ...(task !== undefined ? { task } : {}),
            ...(groups !== undefined ? { groups } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(deliveryMode !== undefined ? { deliveryMode } : {}),
            ...(skip !== undefined ? { skip } : {}),
            ...(after !== undefined ? { after } : {}),
          })) as { item?: string };
          return `Queued ${result.item ?? 'the task'} for pipeline ${pipeline}. It starts when the queue runs.`;
        }),
    );
  }
}

export function registerRepair(kit: WorkerKit): void {
  const { options, server } = kit;
  if (options.repair) {
    server.registerTool(
      WORKER_TOOLS.answer,
      {
        title: 'Answer a question of a group',
        description:
          'Answer the question a group of the task waits for. The group continues with your answer. A question for a person only (human review or human only) is refused. Call swarm_report afterwards as usual.',
        inputSchema: {
          group: z.string().min(1).describe('Slug of the group that waits for an answer'),
          answer: z
            .string()
            .trim()
            .min(1)
            .max(FEEDBACK_LIMIT)
            .describe('The answer, written as a decision'),
        },
      },
      ({ group, answer }) =>
        attempt(async () => {
          await options.send('repair_action', {
            action: 'answer',
            token: options.token,
            group,
            answer,
          });
          return `Recorded the answer for ${group}. Call swarm_report when you are done.`;
        }),
    );
    server.registerTool(
      WORKER_TOOLS.retry,
      {
        title: 'Retry a group',
        description:
          'Run a failed or stopped group again. Pass refresh_config to read swarm.yaml again before the retry. Call swarm_report afterwards as usual.',
        inputSchema: {
          group: z.string().min(1).describe('Slug of the group to retry'),
          refresh_config: z.boolean().optional().describe('Read swarm.yaml again before the retry'),
        },
      },
      ({ group, refresh_config }) =>
        attempt(async () => {
          await options.send('repair_action', {
            action: 'retry',
            token: options.token,
            group,
            ...(refresh_config !== undefined ? { refreshConfig: refresh_config } : {}),
          });
          return `Recorded the retry of ${group}. Call swarm_report when you are done.`;
        }),
    );
    server.registerTool(
      WORKER_TOOLS.cancel,
      {
        title: 'Cancel a group or the task',
        description:
          'Cancel one group, or the whole task when group is omitted. The reason is shown in the task. Refused for a group or task waiting for a person. Call swarm_report afterwards as usual.',
        inputSchema: {
          group: z
            .string()
            .min(1)
            .optional()
            .describe('Slug of the group; omit to cancel the task'),
          reason: z.string().trim().min(1).max(FEEDBACK_LIMIT).describe('Why it is cancelled'),
        },
      },
      ({ group, reason }) =>
        attempt(async () => {
          await options.send('repair_action', {
            action: 'cancel',
            token: options.token,
            ...(group !== undefined ? { group } : {}),
            reason,
          });
          return `Recorded the cancellation${group !== undefined ? ` of ${group}` : ''}. Call swarm_report when you are done.`;
        }),
    );
  }
}
