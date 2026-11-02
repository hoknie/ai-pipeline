import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

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
        tags,
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
      tags: tagNames,
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
          ...(tagNames !== undefined ? { tags: tagNames } : {}),
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
        'Retry a failed or cancelled group from where it stopped, or its merge after a conflict.',
      inputSchema: { run_id: runId, group },
    },
    ({ run_id, group: slug }) => attempt(() => showRun('retry', { runId: run_id, group: slug })),
  );

  server.registerTool(
    'swarm_answer',
    {
      title: 'Answer a question from a specialist',
      description: 'Answer a group in needs_human; the same step runs again with the answer.',
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
        tags,
        skip,
        after,
        repo,
      },
    },
    ({
      workflow,
      task,
      groups,
      title,
      autoDeliver,
      tags: tagNames,
      skip: skipSteps,
      after: afterIds,
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
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
            ...(afterIds !== undefined ? { after: afterIds } : {}),
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
        'Change fields of a waiting task, or move it to a position (1 starts first). A task that already became a run cannot be changed.',
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
        tags,
        skip,
        after,
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
      tags: tagNames,
      skip: skipSteps,
      after: afterIds,
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
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
            ...(afterIds !== undefined ? { after: afterIds } : {}),
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
        'Change the queue settings; only the passed fields change, at least one is required. `parallel`: runs at the same time. `autopilot`: a running queue does not stop when it becomes empty and takes added tasks at once; turning it on starts a stopped queue that has no stop reason. `skip_failed`: a run with a failed, conflicting, cancelled or undelivered group leaves its place and goes to the skipped list, the queue keeps going. Takes effect at once.',
      inputSchema: {
        parallel: z.number().int().min(1).max(20).optional().describe('Runs at the same time'),
        autopilot: z.boolean().optional().describe('Keep the running queue going when it is empty'),
        skip_failed: z
          .boolean()
          .optional()
          .describe('Skip runs with a stopping problem instead of stopping the queue'),
        repo,
      },
    },
    ({ parallel, autopilot, skip_failed, repo: where }) =>
      attempt(() =>
        showQueue(
          'queue_settings',
          {
            ...(parallel !== undefined ? { parallel } : {}),
            ...(autopilot !== undefined ? { autopilot } : {}),
            ...(skip_failed !== undefined ? { skipFailed: skip_failed } : {}),
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
    'swarm_queue_run_now',
    {
      title: 'Run a queued task now',
      description:
        'Turn a waiting task into a run immediately, whatever the state and parallel limit of the queue. The run holds a place of the queue even over the parallel limit (for example 3 of 2).',
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
