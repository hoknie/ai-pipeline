import { z } from 'zod';

import { formatQueue, formatRunCreated } from '../format/index.ts';
import { repositoryArgument } from '../ipc/client/index.ts';
import type { QueueView, RunCreated } from '../ipc/contract/index.ts';
import { attempt } from './tools.ts';
import { withData, type HostKit } from './host-kit.ts';

export function registerQueueParallel(kit: HostKit): void {
  const { server, repo, showQueue } = kit;
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
}

export function registerQueueSettings(kit: HostKit): void {
  const { server, after, group, repo, showQueue } = kit;
  server.registerTool(
    'swarm_queue_settings',
    {
      title: 'Change queue settings',
      description:
        'Change the queue settings; only the passed fields change, at least one is required. `parallel`: runs at the same time. `autopilot`: a running queue does not stop when it becomes empty and takes added tasks at once (it does not answer questions); turning it on starts a stopped queue that has no stop reason. `skip_failed`: a run with a failed, conflicting or undelivered group leaves its place and goes to the skipped list, the queue keeps going; a cancelled run and a usage limit still stop the queue. `on_limit`: what a usage limit of an agent does: `wait` (default) keeps the group waiting for the reset and starts the queue again after it, `stop` fails the group and keeps the queue stopped until started. `auto_answer`: a running queue answers the questions of specialists with the `autopilot_answer` text; turning it on does not start a stopped queue. `autopilot_answer`: with `auto_answer` on, a specialist that asks a question (not more than 3 times in a row per group) gets this text as the answer; null restores the default text. `filter`: which new tasks a running queue takes, `{ pipelines?, tags? }` (pipeline ids, tag names; an empty list means any; a task needs the pipeline and at least one of the tags); changed only while the queue is stopped, queued and returned tasks that do not fit wait. Takes effect at once.',
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
        filter: z
          .object({
            pipelines: z.array(z.string().min(1)).max(50).optional(),
            tags: z.array(z.string().min(1)).max(50).optional(),
          })
          .strict()
          .optional()
          .describe('Take filter: pipeline ids and tag names; only while the queue is stopped'),
        repo,
      },
    },
    ({
      parallel,
      autopilot,
      auto_answer,
      skip_failed,
      autopilot_answer,
      on_limit,
      filter,
      repo: where,
    }) =>
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
            ...(filter !== undefined ? { filter } : {}),
          },
          where,
        ),
      ),
  );
}

export function registerQueuePause(kit: HostKit): void {
  const { server, repo, showQueue } = kit;
  server.registerTool(
    'swarm_queue_pause',
    {
      title: 'Pause the queue',
      description: 'Stop taking new tasks. Runs that already started keep going.',
      inputSchema: { repo },
    },
    ({ repo: where }) => attempt(() => showQueue('queue_pause', {}, where)),
  );
}

export function registerQueueReturn(kit: HostKit): void {
  const { options, server, runId, repo, item } = kit;
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
          .describe('Repository path or project slug; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('queue_return', {
          runId: run_id,
          ...(where !== undefined ? { repository: repositoryArgument(where, options.cwd) } : {}),
        })) as QueueView & { item: string };
        return withData(`Returned ${run_id} as item ${view.item}.\n${formatQueue(view)}`, view);
      }),
  );
}

export function registerRunPause(kit: HostKit): void {
  const { options, server, runId, repo, item } = kit;
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
          .describe('Repository path or project slug; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('run_pause', {
          runId: run_id,
          ...(where !== undefined ? { repository: repositoryArgument(where, options.cwd) } : {}),
        })) as QueueView & { item: string };
        return withData(`Paused ${run_id} as item ${view.item}.\n${formatQueue(view)}`, view);
      }),
  );
}

export function registerQueueDismiss(kit: HostKit): void {
  const { options, server, runId, repo } = kit;
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
          .describe('Repository path or project slug; defaults to the repository of the run'),
      },
    },
    ({ run_id, repo: where }) =>
      attempt(async () => {
        const view = (await options.send('queue_dismiss', {
          runId: run_id,
          ...(where !== undefined ? { repository: repositoryArgument(where, options.cwd) } : {}),
        })) as QueueView;
        return withData(`Dismissed ${run_id}.\n${formatQueue(view)}`, view);
      }),
  );
}

export function registerQueueRunNow(kit: HostKit): void {
  const { options, now, server, repo, item } = kit;
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
}
