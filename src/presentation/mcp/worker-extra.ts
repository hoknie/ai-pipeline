import { z } from 'zod';

import { DELIVERY_MODES } from '../../feature/swarm-config/types/index.ts';
import { FEEDBACK_LIMIT } from '../../feature/runs/types/index.ts';
import { RUN_TITLE_LIMIT, WORKER_TOOLS } from '../../feature/agents/types/index.ts';
import { invalid } from '../../platform/errors/index.ts';
import { attempt, hintDuplicate } from './tools.ts';
import { linkInputs, present } from './host-links.ts';
import type { WorkerKit } from './worker-tools.ts';

/** The provider of a task a specialist adds: its own, never the one of the run. */
const providerField = z
  .string()
  .optional()
  .describe(
    'Id of a provider of the tiers; omit for none: the task does not inherit the provider of this run',
  );

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
          'Put a task at the end of the queue of the repository this run belongs to, to be started later as its own run. Pass either task or groups; pass after with ids to order dependent tasks: ids returned by earlier calls, waiting items of the queues of any project or runs of any repository. The answer contains the id of the new item. A copy of a task that already waits in the queue is refused: to correct a task you queued, change it with swarm_queue_edit or remove it with swarm_queue_remove. It does not start the queue. Call swarm_report afterwards as usual.',
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
          provider: providerField,
          skip: z
            .array(z.string())
            .optional()
            .describe('Ids of pipeline steps this task skips, e.g. ["review", "qa"]'),
          after: z
            .array(z.string().min(1))
            .optional()
            .describe(
              'Ids that must be done first: waiting items of the queues of any project, runs of any repository, e.g. the ids returned by earlier swarm_queue_add calls',
            ),
          links: linkInputs,
        },
      },
      ({ pipeline, ...fields }) =>
        attempt(async () => {
          if ((fields.task === undefined) === (fields.groups === undefined)) {
            throw invalid('mcp.invalid_arguments', 'pass either task or groups');
          }
          const result = (await hintDuplicate(WORKER_DUPLICATE_HINT, () =>
            options.send('worker_queue_add', {
              token: options.token,
              pipeline,
              ...present(fields),
            }),
          )) as { item?: string };
          return `Queued ${result.item ?? 'the task'} for pipeline ${pipeline}. It starts when the queue runs.`;
        }),
    );
  }
}

/** The way out for a specialist: the waiting task is corrected, no copy is added. */
const WORKER_DUPLICATE_HINT =
  'change the waiting task with swarm_queue_edit or remove it with swarm_queue_remove instead of adding a copy';

const ownItem = z
  .string()
  .min(1)
  .describe('Id of a waiting task this run queued, as swarm_queue_add returned it');

/** The fields of a queued task a specialist may change; `null` resets a field to its default. */
const editFields = {
  pipeline: z.string().min(1).optional().describe('Pipeline id of the configuration'),
  task: z.string().trim().min(1).optional().describe('One task text; replaces the groups'),
  groups: z
    .array(z.object({ title: z.string().trim().min(1), task: z.string().trim().min(1) }))
    .min(1)
    .optional()
    .describe('Explicit groups; replace the task text'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(RUN_TITLE_LIMIT)
    .nullable()
    .optional()
    .describe(`Title of the run, at most ${RUN_TITLE_LIMIT} characters; null: none`),
  autoDeliver: z
    .boolean()
    .nullable()
    .optional()
    .describe('Deliver merged groups automatically; null: follow delivery.auto'),
  deliveryMode: z
    .enum(DELIVERY_MODES)
    .nullable()
    .optional()
    .describe('worktree, commit or branch; null: follow delivery.mode'),
  variant: z.string().optional().describe('Id of a variant of the pipeline'),
  provider: z.string().nullable().optional().describe('Id of a provider of the tiers; null: none'),
  skip: z.array(z.string()).optional().describe('Ids of pipeline steps to skip; replaces the list'),
  after: z
    .array(z.string().min(1))
    .optional()
    .describe('Ids that must be done first; replaces the list, [] clears it'),
  links: linkInputs,
};

/** `swarm_queue_edit` and `swarm_queue_remove`: a specialist corrects the tasks its run queued. */
export function registerQueueFix(kit: WorkerKit): void {
  const { options, server } = kit;
  if (!options.queue) return;
  server.registerTool(
    WORKER_TOOLS.queueEdit,
    {
      title: 'Change a task this run queued',
      description:
        'Change a waiting task this run put into the queue: its text or groups, title, pipeline, variant, provider, delivery, skipped steps, after or links. Pass item and at least one field; a field that is not passed stays. Use it to correct a task instead of adding a copy. A task of another run or of a person, and a task that already became a run, is refused. The parent of the task stays this run. It does not start the queue. Call swarm_report afterwards as usual.',
      inputSchema: { item: ownItem, ...editFields },
    },
    ({ item, ...fields }) =>
      attempt(async () => {
        const changes = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        );
        if (Object.keys(changes).length === 0) {
          throw invalid('mcp.invalid_arguments', 'pass at least one field to change');
        }
        if (fields.task !== undefined && fields.groups !== undefined) {
          throw invalid('mcp.invalid_arguments', 'pass either task or groups');
        }
        await options.send('worker_queue_edit', { token: options.token, item, ...changes });
        return `Changed ${item}. Call swarm_report when you are done.`;
      }),
  );
  server.registerTool(
    WORKER_TOOLS.queueRemove,
    {
      title: 'Remove a task this run queued',
      description:
        'Remove a waiting task this run put into the queue; the tasks that waited for it no longer do. A task of another run or of a person, and a task that already became a run, is refused. Call swarm_report afterwards as usual.',
      inputSchema: { item: ownItem },
    },
    ({ item }) =>
      attempt(async () => {
        await options.send('worker_queue_remove', { token: options.token, item });
        return `Removed ${item}. Call swarm_report when you are done.`;
      }),
  );
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
