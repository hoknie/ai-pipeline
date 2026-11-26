import { z } from 'zod';

import { DELIVERY_MODES } from '../../feature/swarm-config/types/index.ts';
import { deliveryBranchSchema } from '../ipc/contract/runs.ts';
import { ALLOW_DUPLICATE, attempt, hintDuplicate, HOST_DUPLICATE_HINT } from './tools.ts';
import { withData, type HostKit } from './host-kit.ts';
import { linkInputs, present } from './host-links.ts';

export function registerQueue(kit: HostKit): void {
  const { server, repo, showQueue } = kit;
  server.registerTool(
    'swarm_queue',
    {
      title: 'Task queue',
      description:
        'Show the task queue of a repository: state, parallel limit, why it stopped, waiting tasks in order and the runs that hold a place. In the global queue mode it is the one queue of all projects (repo is ignored): tasks carry their project and position is the place among all projects.',
      inputSchema: { repo },
    },
    ({ repo: where }) => attempt(() => showQueue('queue', {}, where)),
  );
}

/** How a new task is delivered: both follow the configuration when omitted. */
export const deliveryFields = {
  autoDeliver: z
    .boolean()
    .optional()
    .describe(
      'Deliver merged groups automatically; omit to follow delivery.auto of the configuration',
    ),
  deliveryMode: z
    .enum(DELIVERY_MODES)
    .optional()
    .describe(
      'How the merged result is delivered (worktree, commit or branch); omit to follow delivery.mode of the configuration',
    ),
  deliveryBranch: deliveryBranchSchema
    .optional()
    .describe('Local target branch for automatic commit delivery'),
};

export function registerQueueAdd(kit: HostKit): void {
  const { server, tags, parent, variant, skip, after, attachments, repo, queueGroups, showQueue } =
    kit;
  server.registerTool(
    'swarm_queue_add',
    {
      title: 'Add a task to the queue',
      description:
        'Put a task at the end of the repository queue. Pass either task or groups. It does not start the queue: call swarm_queue_start. A copy of a task that already waits in the queue is refused: the error names the waiting task.',
      inputSchema: {
        pipeline: z.string().describe('Pipeline id from swarm.yaml'),
        task: z.string().optional().describe('One task text'),
        groups: queueGroups.optional(),
        title: z.string().optional().describe('Title of the run, at most 60 characters'),
        ...deliveryFields,
        tags,
        parent,
        variant,
        provider: kit.provider,
        skip,
        after,
        inheritTags: z
          .boolean()
          .optional()
          .describe('false: the task takes no tags of its predecessors, now and later'),
        links: linkInputs,
        attachments,
        postponed: z
          .boolean()
          .optional()
          .describe('true: a running queue does not take the task until you clear the flag'),
        allowDuplicate: z.boolean().optional().describe(ALLOW_DUPLICATE),
        repo,
      },
    },
    ({
      pipeline,
      variant: variantId,
      provider: providerId,
      task,
      groups,
      title,
      autoDeliver,
      deliveryMode,
      deliveryBranch,
      tags: tagNames,
      parent: parentRef,
      skip: skipSteps,
      after: afterIds,
      inheritTags,
      links: taskLinks,
      attachments: files,
      postponed,
      allowDuplicate,
      repo: where,
    }) =>
      attempt(() =>
        hintDuplicate(HOST_DUPLICATE_HINT, () =>
          showQueue(
            'queue_add',
            {
              pipeline,
              ...present({ variant: variantId, provider: providerId }),
              ...present({ task, groups, title }),
              ...present({ autoDeliver, deliveryMode, deliveryBranch }),
              ...(tagNames !== undefined ? { tags: tagNames } : {}),
              ...(parentRef !== undefined ? { parent: parentRef } : {}),
              ...present({ skip: skipSteps, after: afterIds, links: taskLinks }),
              ...(inheritTags !== undefined ? { inheritTags } : {}),
              ...(files !== undefined ? { attachments: files.map((path) => ({ path })) } : {}),
              ...(postponed !== undefined ? { postponed } : {}),
              ...(allowDuplicate !== undefined ? { allowDuplicate } : {}),
            },
            where,
          ),
        ),
      ),
  );
}

const postponedEdit = z
  .boolean()
  .optional()
  .describe('true: a running queue does not take the task until you clear the flag');

/** Fields of swarm_queue_edit; most of them repeat swarm_queue_add on a waiting task. */
function queueEditInput(kit: HostKit) {
  const { tags, parent, variant, skip, after, repo, item, queueGroups } = kit;
  return {
    item,
    pipeline: z.string().optional(),
    variant,
    provider: kit.provider,
    task: z.string().optional(),
    groups: queueGroups.optional(),
    title: z.string().nullable().optional().describe('null removes the title'),
    position: z.number().int().min(1).optional().describe('New position, from 1'),
    autoDeliver: z
      .boolean()
      .nullable()
      .optional()
      .describe('Automatic delivery of this task; null follows delivery.auto again'),
    deliveryMode: z
      .enum(DELIVERY_MODES)
      .nullable()
      .optional()
      .describe('Delivery mode of this task; null follows delivery.mode again'),
    deliveryBranch: deliveryBranchSchema
      .nullable()
      .optional()
      .describe('Local target branch; null removes it'),
    tags,
    parent: parent
      .nullable()
      .describe(
        'Run id or task number of this repository: replaces the linked task tags of the task with the tag of that run; null removes them',
      ),
    skip,
    after,
    inheritTags: z
      .boolean()
      .optional()
      .describe(
        'false: the task stops taking the tags of its predecessors; true: it takes them again',
      ),
    links: linkInputs,
    postponed: postponedEdit,
    repo,
  };
}

export function registerQueueEdit(kit: HostKit): void {
  const { server, showQueue } = kit;
  server.registerTool(
    'swarm_queue_edit',
    {
      title: 'Change a queued task',
      description:
        'Change fields of a waiting task, or move it to a position (1 starts first). A task that already became a run cannot be changed, except `skip`: for a returned run it skips or restores the steps of the run at once.',
      inputSchema: queueEditInput(kit),
    },
    ({
      item: id,
      pipeline,
      variant: variantId,
      provider: providerId,
      task,
      groups,
      title,
      position,
      autoDeliver,
      deliveryMode,
      deliveryBranch,
      tags: tagNames,
      parent: parentRef,
      skip: skipSteps,
      after: afterIds,
      inheritTags,
      links: taskLinks,
      postponed,
      repo: where,
    }) =>
      attempt(() =>
        showQueue(
          'queue_edit',
          {
            item: id,
            ...(pipeline !== undefined ? { pipeline } : {}),
            ...present({ variant: variantId, provider: providerId }),
            ...present({ task, groups, title }),
            ...(position !== undefined ? { position } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(deliveryMode !== undefined ? { deliveryMode } : {}),
            ...(deliveryBranch !== undefined ? { deliveryBranch } : {}),
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(parentRef !== undefined ? { parent: parentRef } : {}),
            ...present({ skip: skipSteps, after: afterIds, links: taskLinks }),
            ...(inheritTags !== undefined ? { inheritTags } : {}),
            ...(postponed !== undefined ? { postponed } : {}),
          },
          where,
        ),
      ),
  );
}

export function registerQueueRemove(kit: HostKit): void {
  const { server, repo, item, showQueue } = kit;
  server.registerTool(
    'swarm_queue_remove',
    {
      title: 'Remove a queued task',
      description: 'Remove a waiting task from the queue.',
      inputSchema: { item, repo },
    },
    ({ item: id, repo: where }) => attempt(() => showQueue('queue_remove', { item: id }, where)),
  );
}

export function registerQueueStart(kit: HostKit): void {
  const { server, repo, showQueue } = kit;
  server.registerTool(
    'swarm_queue_start',
    {
      title: 'Start the queue',
      description:
        'Start taking tasks from the beginning of the queue, `parallel` runs at a time. Also continues a queue that stopped on a problem: the current problems become known.',
      inputSchema: {
        parallel: z.number().int().min(1).max(20).optional().describe('Runs at the same time'),
        repo,
      },
    },
    ({ parallel, repo: where }) =>
      attempt(() => showQueue('queue_start', parallel !== undefined ? { parallel } : {}, where)),
  );
}
