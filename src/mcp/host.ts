import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DELIVERY_MODES } from '../config/index.ts';
import {
  formatApply,
  formatGroup,
  formatQueue,
  formatRun,
  formatRunCreated,
  formatRunQueued,
  formatRunList,
  type ApplyResult,
  type GroupView,
  type QueueView,
  type RunCreated,
  type RunQueued,
  type RunView,
} from '../protocol/index.ts';

import { attempt, type Send } from './tools.ts';
import { VERSION } from './version.ts';

export interface HostOptions {
  send: Send;
  cwd: string;
  now?: () => number;
}

function withData(text: string, data: unknown): string {
  return `${text}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

export function createHostServer(options: HostOptions): McpServer {
  const now = options.now ?? Date.now;
  const server = new McpServer({ name: 'aip', version: VERSION });
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
      'Ids of workflow steps this task skips, e.g. ["review", "qa"]. Edit replaces the whole list; [] runs every step',
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

  server.registerTool(
    'swarm_run',
    {
      title: 'Queue a swarm task',
      description:
        'Queue a workflow from the aip/ configuration in a git repository: the task goes to the end of the repository queue, a stopped queue is started, and the run is created when the queue takes the task (the answer says whether it already exists). Pass either task (one text; the workflow may split it into groups) or groups (explicit list). The run works in its own branches; your working copy is not changed.',
      inputSchema: {
        workflow: z.string().describe('Workflow id from the aip/ configuration'),
        task: z.string().optional().describe('One task text'),
        groups: z
          .array(z.object({ title: z.string(), task: z.string() }))
          .optional()
          .describe('Explicit groups'),
        repo: z.string().optional().describe('Repository path; defaults to the current directory'),
        title: z
          .string()
          .optional()
          .describe('Short title of the run, at most 60 characters; otherwise a model names it'),
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
      },
    },
    ({
      workflow,
      task,
      groups,
      repo,
      title,
      autoDeliver,
      deliveryMode,
      tags: tagNames,
      parent: parentRef,
      skip: skipSteps,
      after: afterIds,
    }) =>
      attempt(async () => {
        const queued = (await options.send('run', {
          repository: repo ?? options.cwd,
          workflow,
          ...(task !== undefined ? { task } : {}),
          ...(groups !== undefined ? { groups } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(autoDeliver !== undefined ? { autoDeliver } : {}),
          ...(deliveryMode !== undefined ? { deliveryMode } : {}),
          ...(tagNames !== undefined ? { tags: tagNames } : {}),
          ...(parentRef !== undefined ? { parent: parentRef } : {}),
          ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
          ...(afterIds !== undefined ? { after: afterIds } : {}),
        })) as RunQueued;
        return withData(formatRunQueued(queued), queued);
      }),
  );

  server.registerTool(
    'swarm_status',
    {
      title: 'Swarm progress',
      description:
        'Without run_id: active runs and the 10 latest finished ones. With run_id: the table of groups of that run.',
      inputSchema: { run_id: runId.optional() },
    },
    ({ run_id }) =>
      attempt(async () => {
        if (run_id) return showRun('status', { runId: run_id });
        const runs = (await options.send('status', {})) as RunView[];
        return withData(formatRunList(runs), runs);
      }),
  );

  server.registerTool(
    'swarm_group',
    {
      title: 'Group details',
      description:
        'Every attempt of a group with verdicts, summaries, feedback, usage, and the tail of the latest log.',
      inputSchema: {
        run_id: runId,
        group,
        tail_lines: z.number().int().min(1).max(500).optional(),
      },
    },
    ({ run_id, group: slug, tail_lines }) =>
      attempt(async () => {
        const view = (await options.send('group', {
          runId: run_id,
          group: slug,
          ...(tail_lines !== undefined ? { tailLines: tail_lines } : {}),
        })) as GroupView;
        return withData(formatGroup(view), view);
      }),
  );

  server.registerTool(
    'swarm_cancel',
    {
      title: 'Cancel a run or a group',
      description: 'Stop running specialists and cancel one group, or the whole run without group.',
      inputSchema: { run_id: runId, group: group.optional() },
    },
    ({ run_id, group: slug }) =>
      attempt(() => showRun('cancel', { runId: run_id, ...(slug ? { group: slug } : {}) })),
  );

  server.registerTool(
    'swarm_retry',
    {
      title: 'Retry a group',
      description:
        'Retry a failed or cancelled group from where it stopped, or its merge after a conflict. With refresh_config=true the run first takes the whole specialists (model, runtime, prompt, permissions) from the current configuration; the workflow stays as it started. If the run joins the queue and every place is taken, the last run that took a place is frozen: it finishes its current step and continues when a place is free.',
      inputSchema: {
        run_id: runId,
        group,
        refresh_config: z
          .boolean()
          .optional()
          .describe('Take the specialists of the current configuration before the retry'),
      },
    },
    ({ run_id, group: slug, refresh_config }) =>
      attempt(() =>
        showRun('retry', {
          runId: run_id,
          group: slug,
          ...(refresh_config ? { refreshConfig: true } : {}),
        }),
      ),
  );

  server.registerTool(
    'swarm_skip_step',
    {
      title: 'Skip a step of a run',
      description:
        'Skip a step that is running or still ahead, or pass skip=false to bring it back. A running step is stopped without a commit. Steps already passed by every group cannot be skipped.',
      inputSchema: { run_id: runId, step: z.string().min(1), skip: z.boolean().optional() },
    },
    ({ run_id, step, skip }) =>
      attempt(() => showRun('run_skip', { runId: run_id, step, skip: skip ?? true })),
  );

  server.registerTool(
    'swarm_answer',
    {
      title: 'Answer a question from a specialist',
      description:
        'Answer a group in needs_human; the same step runs again with the answer. A group with humanOnly (a human review or a specialist asking for a person) is answered only with the words of the user: never invent the answer or accept on their behalf.',
      inputSchema: { run_id: runId, group, answer: z.string().min(1) },
    },
    ({ run_id, group: slug, answer }) =>
      attempt(() => showRun('answer', { runId: run_id, group: slug, answer })),
  );

  server.registerTool(
    'swarm_apply',
    {
      title: 'Deliver the result of a run',
      description:
        'Deliver merged groups into the working tree (or as one commit or a branch, as delivery.mode says). Refuses without changing anything when files overlap with uncommitted changes or conflict; force applies with conflict markers.',
      inputSchema: {
        run_id: runId,
        groups: z
          .array(z.string())
          .optional()
          .describe('Groups to deliver; all merged ones by default'),
        force: z
          .boolean()
          .optional()
          .describe('Apply even with conflicts, leaving conflict markers'),
      },
    },
    ({ run_id, groups, force }) =>
      attempt(async () => {
        const result = (await options.send('apply', {
          runId: run_id,
          ...(groups ? { groups } : {}),
          ...(force !== undefined ? { force } : {}),
        })) as ApplyResult;
        return withData(formatApply(result), result);
      }),
  );

  server.registerTool(
    'swarm_mark_delivered',
    {
      description:
        'Mark merged groups of a run as delivered when you merged their result by hand. Nothing is applied to the working tree; the run becomes finished and queue tasks depending on it continue. Refuses groups that are not merged or already delivered.',
      inputSchema: {
        run_id: runId,
        groups: z
          .array(z.string())
          .optional()
          .describe('Groups to mark; all merged ones that are not delivered by default'),
      },
    },
    ({ run_id, groups }) =>
      attempt(async () => {
        const result = (await options.send('run_mark_delivered', {
          runId: run_id,
          ...(groups ? { groups } : {}),
        })) as ApplyResult;
        return withData(formatApply(result), result);
      }),
  );

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

  server.registerTool(
    'swarm_queue_add',
    {
      title: 'Add a task to the queue',
      description:
        'Put a task at the end of the repository queue. Pass either task or groups. It does not start the queue: call swarm_queue_start.',
      inputSchema: {
        workflow: z.string().describe('Workflow id from swarm.yaml'),
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
      workflow,
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
            workflow,
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

  server.registerTool(
    'swarm_queue_edit',
    {
      title: 'Change a queued task',
      description:
        'Change fields of a waiting task, or move it to a position (1 starts first). A task that already became a run cannot be changed, except `skip`: for a returned run it skips or restores the steps of the run at once.',
      inputSchema: {
        item,
        workflow: z.string().optional(),
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
      workflow,
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
            ...(workflow !== undefined ? { workflow } : {}),
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

  server.registerTool(
    'swarm_queue_remove',
    {
      title: 'Remove a queued task',
      description: 'Remove a waiting task from the queue.',
      inputSchema: { item, repo },
    },
    ({ item: id, repo: where }) => attempt(() => showQueue('queue_remove', { item: id }, where)),
  );

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

  server.registerTool(
    'swarm_queue_parallel',
    {
      title: 'Change queue parallelism',
      description:
        'Change how many runs the queue holds at the same time. Works in any queue state and takes effect at once: waiting tasks start when the queue is running and places are free; runs already started are never interrupted when the number goes down.',
      inputSchema: {
        parallel: z.number().int().min(1).max(20).describe('Runs at the same time'),
        repo,
      },
    },
    ({ parallel, repo: where }) => attempt(() => showQueue('queue_settings', { parallel }, where)),
  );

  server.registerTool(
    'swarm_queue_settings',
    {
      title: 'Change queue settings',
      description:
        'Change the queue settings; only the passed fields change, at least one is required. `parallel`: runs at the same time. `autopilot`: a running queue does not stop when it becomes empty and takes added tasks at once (it does not answer questions); turning it on starts a stopped queue that has no stop reason. `skip_failed`: a run with a failed, conflicting or undelivered group leaves its place and goes to the skipped list, the queue keeps going; a cancelled run and a usage limit still stop the queue. `on_limit`: what a usage limit of an agent does: `wait` (default) keeps the group waiting for the reset and starts the queue again after it, `stop` fails the group and keeps the queue stopped until started. `auto_answer`: a running queue answers the questions of specialists with the `autopilot_answer` text; turning it on does not start a stopped queue. `autopilot_answer`: with `auto_answer` on, a specialist that asks a question (not more than 3 times in a row per group) gets this text as the answer; null restores the default text. Takes effect at once.',
      inputSchema: {
        parallel: z.number().int().min(1).max(20).optional().describe('Runs at the same time'),
        autopilot: z.boolean().optional().describe('Keep the running queue going when it is empty'),
        auto_answer: z
          .boolean()
          .optional()
          .describe('Answer specialists questions with the autopilot_answer text'),
        skip_failed: z
          .boolean()
          .optional()
          .describe('Skip runs with a stopping problem instead of stopping the queue'),
        autopilot_answer: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Text the queue answers specialists questions with when auto_answer is on; null restores the default text',
          ),
        on_limit: z
          .enum(['wait', 'stop'])
          .optional()
          .describe('On a usage limit: wait for the reset and go on, or stop'),
        repo,
      },
    },
    ({ parallel, autopilot, auto_answer, skip_failed, autopilot_answer, on_limit, repo: where }) =>
      attempt(() =>
        showQueue(
          'queue_settings',
          {
            ...(parallel !== undefined ? { parallel } : {}),
            ...(autopilot !== undefined ? { autopilot } : {}),
            ...(auto_answer !== undefined ? { autoAnswer: auto_answer } : {}),
            ...(skip_failed !== undefined ? { skipFailed: skip_failed } : {}),
            ...(autopilot_answer !== undefined ? { autopilotAnswer: autopilot_answer } : {}),
            ...(on_limit !== undefined ? { onLimit: on_limit } : {}),
          },
          where,
        ),
      ),
  );

  server.registerTool(
    'swarm_queue_pause',
    {
      title: 'Pause the queue',
      description: 'Stop taking new tasks. Runs that already started keep going.',
      inputSchema: { repo },
    },
    ({ repo: where }) => attempt(() => showQueue('queue_pause', {}, where)),
  );

  server.registerTool(
    'swarm_queue_return',
    {
      title: 'Return a run to the queue',
      description:
        'Put a run with failed or cancelled groups back into its queue as the first task. When the queue takes it (a free place in a running queue, or swarm_queue_run_now), the failed and cancelled groups are retried from where they stopped; the work already done is kept and no new run is created. A running queue takes the returned run at once; if every place is taken, the last run that took a place is frozen until it is free.',
      inputSchema: {
        run_id: runId,
        repo: z
          .string()
          .optional()
          .describe('Repository path; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('queue_return', {
          runId: run_id,
          ...(where !== undefined ? { repository: where } : {}),
        })) as QueueView & { item: string };
        return withData(`Returned ${run_id} as item ${view.item}.\n${formatQueue(view)}`, view);
      }),
  );

  server.registerTool(
    'swarm_run_pause',
    {
      title: 'Pause a run',
      description:
        'Pause an unfinished run. The running agents are stopped, no new step starts, and the run moves to the end of its queue and frees its place. Continue it with swarm_queue_run_now on its queue item: the interrupted step goes on in the same session.',
      inputSchema: {
        run_id: runId,
        repo: z
          .string()
          .optional()
          .describe('Repository path; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('run_pause', {
          runId: run_id,
          ...(where !== undefined ? { repository: where } : {}),
        })) as QueueView & { item: string };
        return withData(`Paused ${run_id} as item ${view.item}.\n${formatQueue(view)}`, view);
      }),
  );

  server.registerTool(
    'swarm_queue_dismiss',
    {
      title: 'Remove a skipped run from the queue',
      description:
        'Remove a run from the skipped list of its queue. The run itself does not change: it keeps its status and can still be opened and delivered. Use it for a skipped run that cannot be returned, for example when its delivery failed.',
      inputSchema: {
        run_id: runId,
        repo: z
          .string()
          .optional()
          .describe('Repository path; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('queue_dismiss', {
          runId: run_id,
          ...(where !== undefined ? { repository: where } : {}),
        })) as QueueView;
        return withData(`Dismissed ${run_id}.\n${formatQueue(view)}`, view);
      }),
  );

  server.registerTool(
    'swarm_queue_run_now',
    {
      title: 'Run a queued task now',
      description:
        'Turn a waiting task into a run immediately, whatever the state and parallel limit of the queue. If every place is taken, the last run that took a place is frozen (it finishes its current step, starts no new one and continues when a place is free); only when nothing can be frozen does the run go over the parallel limit. For a paused or frozen run this is Continue.',
      inputSchema: { item, repo },
    },
    ({ item: id, repo: where }) =>
      attempt(async () => {
        const created = (await options.send('queue_run_now', {
          repository: where ?? options.cwd,
          item: id,
        })) as RunCreated;
        return withData(formatRunCreated(created), created);
      }),
  );

  return server;
}
