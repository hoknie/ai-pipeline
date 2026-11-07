import { z } from 'zod';

import { DELIVERY_MODES } from '../../feature/swarm-config/types/index.ts';
import { attempt } from './tools.ts';
import { withData, type HostKit } from './host-kit.ts';

export function registerQueue(kit: HostKit): void {
  const { server, repo, showQueue } = kit;
  server.registerTool(
    'swarm_queue',
    {
      title: 'Task queue',
      description:
        'Show the task queue of a repository: state, parallel limit, why it stopped, waiting tasks in order and the runs that hold a place.',
      inputSchema: { repo },
    },
    ({ repo: where }) => attempt(() => showQueue('queue', {}, where)),
  );
}

export function registerQueueAdd(kit: HostKit): void {
  const { server, tags, parent, skip, after, repo, queueGroups, showQueue } = kit;
  server.registerTool(
    'swarm_queue_add',
    {
      title: 'Add a task to the queue',
      description:
        'Put a task at the end of the repository queue. Pass either task or groups. It does not start the queue: call swarm_queue_start.',
      inputSchema: {
        pipeline: z.string().describe('Pipeline id from swarm.yaml'),
        task: z.string().optional().describe('One task text'),
        groups: queueGroups.optional(),
        title: z.string().optional().describe('Title of the run, at most 60 characters'),
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
        tags,
        parent,
        skip,
        after,
        postponed: z
          .boolean()
          .optional()
          .describe('true: a running queue does not take the task until you clear the flag'),
        repo,
      },
    },
    ({
      pipeline,
      task,
      groups,
      title,
      autoDeliver,
      deliveryMode,
      tags: tagNames,
      parent: parentRef,
      skip: skipSteps,
      after: afterIds,
      postponed,
      repo: where,
    }) =>
      attempt(() =>
        showQueue(
          'queue_add',
          {
            pipeline,
            ...(task !== undefined ? { task } : {}),
            ...(groups !== undefined ? { groups } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(deliveryMode !== undefined ? { deliveryMode } : {}),
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(parentRef !== undefined ? { parent: parentRef } : {}),
            ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
            ...(afterIds !== undefined ? { after: afterIds } : {}),
            ...(postponed !== undefined ? { postponed } : {}),
          },
          where,
        ),
      ),
  );
}

export function registerQueueEdit(kit: HostKit): void {
  const { server, tags, parent, skip, after, repo, item, queueGroups, showQueue } = kit;
  server.registerTool(
    'swarm_queue_edit',
    {
      title: 'Change a queued task',
      description:
        'Change fields of a waiting task, or move it to a position (1 starts first). A task that already became a run cannot be changed, except `skip`: for a returned run it skips or restores the steps of the run at once.',
      inputSchema: {
        item,
        pipeline: z.string().optional(),
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
        tags,
        parent: parent
          .nullable()
          .describe(
            'Run id or task number of this repository: replaces the linked task tags of the task with the tag of that run; null removes them',
          ),
        skip,
        after,
        postponed: z
          .boolean()
          .optional()
          .describe('true: a running queue does not take the task until you clear the flag'),
        repo,
      },
    },
    ({
      item: id,
      pipeline,
      task,
      groups,
      title,
      position,
      autoDeliver,
      deliveryMode,
      tags: tagNames,
      parent: parentRef,
      skip: skipSteps,
      after: afterIds,
      postponed,
      repo: where,
    }) =>
      attempt(() =>
        showQueue(
          'queue_edit',
          {
            item: id,
            ...(pipeline !== undefined ? { pipeline } : {}),
            ...(task !== undefined ? { task } : {}),
            ...(groups !== undefined ? { groups } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(deliveryMode !== undefined ? { deliveryMode } : {}),
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(parentRef !== undefined ? { parent: parentRef } : {}),
            ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
            ...(afterIds !== undefined ? { after: afterIds } : {}),
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
