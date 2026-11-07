import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DELIVERY_MODES } from '../feature/swarm-config/types/index.ts';
import {
  ARTIFACT_CONTENT_LIMIT,
  ARTIFACT_FILE_NAME_LIMIT,
  ARTIFACT_TITLE_LIMIT,
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  RECOMMENDATION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RUN_TITLE_LIMIT,
  SUMMARY_LIMIT,
  VERDICTS,
  validArtifactFileName,
} from '../core/index.ts';
import { VERSION } from './version.ts';

import { attempt, type Send } from './tools.ts';

export interface WorkerOptions {
  token: string;
  split: boolean;
  /** Also serve swarm_queue_add: the specialist may add tasks to the queue of the run's repository. */
  queue?: boolean;
  /** Also serve swarm_repair_*: the observer of an incident answers, retries or cancels. */
  repair?: boolean;
  send: Send;
}

export function createWorkerServer(options: WorkerOptions): McpServer {
  const server = new McpServer({ name: 'aip', version: VERSION });
  server.registerTool(
    'swarm_report',
    {
      title: 'Report the result of this step',
      description:
        'Call this exactly once as your last action. verdict: "done" when the step is complete; "rejected" when the received work must be redone (put concrete remarks into feedback); "needs_human" when a person must decide (put the question into feedback, or pass several independent questions as questions, each with a recommendation and, for a clear choice, options; set human_only when only a person may answer, for example when you ask for a personal look at the result).',
      inputSchema: {
        verdict: z.enum(VERDICTS),
        summary: z.string().min(1).max(SUMMARY_LIMIT).describe('What you did, in a few sentences'),
        feedback: z
          .string()
          .max(FEEDBACK_LIMIT)
          .optional()
          .describe('Required for rejected; for needs_human required unless questions is given'),
        questions: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(QUESTION_TEXT_LIMIT),
              options: z
                .array(z.string().trim().min(1).max(OPTION_LIMIT))
                .min(1)
                .max(OPTIONS_LIMIT)
                .optional()
                .describe('Answer choices when the answer is a clear choice'),
              recommendation: z
                .string()
                .trim()
                .min(1)
                .max(RECOMMENDATION_LIMIT)
                .optional()
                .describe('Your recommended answer'),
            }),
          )
          .min(1)
          .max(QUESTIONS_LIMIT)
          .optional()
          .describe('Only with needs_human: independent questions for the person'),
        human_only: z
          .boolean()
          .optional()
          .describe(
            'Only with needs_human: a person must look personally; the queue autopilot does not answer',
          ),
      },
    },
    ({ verdict, summary, feedback, questions, human_only }) =>
      attempt(async () => {
        await options.send('report', {
          token: options.token,
          verdict,
          summary,
          feedback: feedback ?? null,
          questions: questions ?? null,
          human_only: human_only ?? null,
        });
        return `Recorded verdict ${verdict}. You can stop now.`;
      }),
  );
  server.registerTool(
    'swarm_artifact',
    {
      title: 'Publish an artifact',
      description:
        'Publish a file of this step (a report, a log, a template) as an artifact of the group. Artifacts are stored by the daemon outside of git, are shown in the panel on the Artifacts tab and never reach the delivered diff. Pass the text as content (best for reports and logs), or path to an existing file of your worktree that git ignores (build output, tmp/): a file that git tracks would be committed. Files named *.md and *.log can be previewed in the panel, others are downloaded. Publishing the same file_name again in this step replaces the artifact. Then call swarm_report as usual.',
      inputSchema: {
        file_name: z
          .string()
          .max(ARTIFACT_FILE_NAME_LIMIT)
          .refine(validArtifactFileName, { message: 'not a plain file name' })
          .describe('File name with extension, without a directory, e.g. review.md'),
        title: z
          .string()
          .trim()
          .min(1)
          .max(ARTIFACT_TITLE_LIMIT)
          .optional()
          .describe('Title shown in the list; defaults to the file name without extension'),
        content: z
          .string()
          .max(ARTIFACT_CONTENT_LIMIT)
          .optional()
          .describe('The text of the file, at most 1 MiB; pass either content or path'),
        path: z
          .string()
          .min(1)
          .optional()
          .describe('A file inside your worktree, at most 16 MiB; pass either content or path'),
      },
    },
    ({ file_name, title, content, path }) =>
      attempt(async () => {
        if ((content === undefined) === (path === undefined)) {
          throw new Error('pass either content or path');
        }
        const result = (await options.send('artifact_publish', {
          token: options.token,
          fileName: file_name,
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
          ...(path !== undefined ? { path } : {}),
        })) as { id?: string };
        return `Recorded artifact ${result.id ?? ''} (${file_name}). Call swarm_report when you are done.`;
      }),
  );
  if (options.split) {
    server.registerTool(
      'swarm_split',
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
  if (options.queue) {
    server.registerTool(
      'swarm_queue_add',
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
      ({ pipeline, task, groups, title, autoDeliver, deliveryMode, skip, after }) =>
        attempt(async () => {
          if ((task === undefined) === (groups === undefined)) {
            throw new Error('pass either task or groups');
          }
          const result = (await options.send('worker_queue_add', {
            token: options.token,
            pipeline,
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
  if (options.repair) {
    server.registerTool(
      'swarm_repair_answer',
      {
        title: 'Answer a question of a group',
        description:
          'Answer the question a group of the task waits for. The group continues with your answer. Call swarm_report afterwards as usual.',
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
      'swarm_repair_retry',
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
      'swarm_repair_cancel',
      {
        title: 'Cancel a group or the task',
        description:
          'Cancel one group, or the whole task when group is omitted. The reason is shown in the task. Call swarm_report afterwards as usual.',
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
  return server;
}
