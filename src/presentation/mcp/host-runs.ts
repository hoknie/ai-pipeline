import { z } from 'zod';

import { formatApply, formatGroup, formatRunQueued, formatRunList } from '../format/index.ts';
import { repositoryArgument } from '../ipc/client/index.ts';
import type { ApplyResult, GroupView, RunQueued, RunView } from '../ipc/contract/index.ts';
import { ALLOW_DUPLICATE, attempt, hintDuplicate, HOST_DUPLICATE_HINT } from './tools.ts';
import { withData, type HostKit } from './host-kit.ts';
import { deliveryFields } from './host-queue.ts';
import { linkInputs, present } from './host-links.ts';

export function registerRun(kit: HostKit): void {
  const { options, server, tags, parent, variant, skip, after, attachments, repo } = kit;
  server.registerTool(
    'swarm_run',
    {
      title: 'Queue a swarm task',
      description:
        'Queue a pipeline from the aip/ configuration in a git repository: the task goes to the end of the repository queue, a stopped queue is started, and the run is created when the queue takes the task (the answer says whether it already exists). Pass either task (one text; the pipeline may split it into groups) or groups (explicit list). The run works in its own branches; your working copy is not changed. A copy of a task that already waits in the queue is refused: the error names the waiting task.',
      inputSchema: {
        pipeline: z.string().describe('Pipeline id from the aip/ configuration'),
        task: z.string().optional().describe('One task text'),
        groups: z
          .array(z.object({ title: z.string(), task: z.string() }))
          .optional()
          .describe('Explicit groups'),
        repo: kit.repo,
        title: z
          .string()
          .optional()
          .describe('Short title of the run, at most 60 characters; otherwise a model names it'),
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
        allowDuplicate: z.boolean().optional().describe(ALLOW_DUPLICATE),
      },
    },
    ({
      pipeline,
      variant: variantId,
      provider: providerId,
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
      inheritTags,
      links: taskLinks,
      attachments: files,
      allowDuplicate,
    }) =>
      attempt(async () => {
        const send = () =>
          options.send('run', {
            repository: repo === undefined ? options.cwd : repositoryArgument(repo, options.cwd),
            pipeline,
            ...present({ variant: variantId, provider: providerId }),
            ...(task !== undefined ? { task } : {}),
            ...(groups !== undefined ? { groups } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(deliveryMode !== undefined ? { deliveryMode } : {}),
            ...(tagNames !== undefined ? { tags: tagNames } : {}),
            ...(parentRef !== undefined ? { parent: parentRef } : {}),
            ...(skipSteps !== undefined ? { skip: skipSteps } : {}),
            ...(afterIds !== undefined ? { after: afterIds } : {}),
            ...(inheritTags !== undefined ? { inheritTags } : {}),
            ...(taskLinks !== undefined ? { links: taskLinks } : {}),
            ...(files !== undefined ? { attachments: files.map((path) => ({ path })) } : {}),
            ...(allowDuplicate !== undefined ? { allowDuplicate } : {}),
          });
        const queued = (await hintDuplicate(HOST_DUPLICATE_HINT, send)) as RunQueued;
        return withData(formatRunQueued(queued), queued);
      }),
  );
}

export function registerStatus(kit: HostKit): void {
  const { options, server, runId, showRun } = kit;
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
}

export function registerGroup(kit: HostKit): void {
  const { options, server, runId, group } = kit;
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
}

export function registerCancel(kit: HostKit): void {
  const { server, runId, group, showRun } = kit;
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
}

export function registerRetry(kit: HostKit): void {
  const { server, runId, after, group, showRun } = kit;
  server.registerTool(
    'swarm_retry',
    {
      title: 'Retry a group',
      description:
        'Retry a failed or cancelled group from where it stopped, or its merge after a conflict. With refresh_config=true the run first takes the whole specialists (model, runtime, prompt, permissions) from the current configuration; the pipeline stays as it started. If the run joins the queue and every place is taken, the last run that took a place is frozen: it finishes its current step and continues when a place is free.',
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
}

export function registerSkipStep(kit: HostKit): void {
  const { server, runId, skip, group, showRun } = kit;
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
}

export function registerVariant(kit: HostKit): void {
  const { server, runId, showRun } = kit;
  server.registerTool(
    'swarm_run_variant',
    {
      title: 'Switch a run to another variant of its pipeline',
      description:
        'Switch a run that is not finished to another variant of its pipeline (default is the pipeline as it is). A running step whose specialist, model or prompt changes is stopped without a commit and starts again with the new variant; the other steps go on. The skips of the variant are not applied to a run that has started.',
      inputSchema: { run_id: runId, variant: z.string().min(1) },
    },
    ({ run_id, variant }) => attempt(() => showRun('run_variant', { runId: run_id, variant })),
  );
}

export function registerProvider(kit: HostKit): void {
  const { server, runId, showRun } = kit;
  server.registerTool(
    'swarm_run_provider',
    {
      title: 'Switch a run to another provider',
      description:
        'Switch a run that is not finished to another provider of the tiers, or pass null for none. A running step on a tier whose item changes with the provider is stopped without a commit and starts again in a new session; the other steps go on. A waiting group takes the new item with its next attempt. Resetting to none does not stop a running step.',
      inputSchema: {
        run_id: runId,
        provider: z.string().min(1).nullable().describe('Id of a provider, or null for none'),
      },
    },
    ({ run_id, provider }) => attempt(() => showRun('run_provider', { runId: run_id, provider })),
  );
}

export function registerAnswer(kit: HostKit): void {
  const { server, runId, group, showRun } = kit;
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
}

export function registerApply(kit: HostKit): void {
  const { options, server, runId } = kit;
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
}

export function registerMarkDelivered(kit: HostKit): void {
  const { options, server, runId } = kit;
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
}
