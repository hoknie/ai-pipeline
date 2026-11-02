import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  RECOMMENDATION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RUN_TITLE_LIMIT,
  SUMMARY_LIMIT,
  VERDICTS,
} from '../core/index.ts';
import { VERSION } from './version.ts';

import { attempt, type Send } from './tools.ts';

export interface WorkerOptions {
  token: string;
  split: boolean;
  /** Also serve swarm_queue_add: the specialist may add tasks to the queue of the run's repository. */
  queue?: boolean;
  send: Send;
}

export function createWorkerServer(options: WorkerOptions): McpServer {
  const server = new McpServer({ name: 'aip', version: VERSION });
  server.registerTool(
    'swarm_report',
    {
      title: 'Report the result of this step',
      description:
        'Call this exactly once as your last action. verdict: "done" when the step is complete; "rejected" when the received work must be redone (put concrete remarks into feedback); "needs_human" when a person must decide (put the question into feedback, or pass several independent questions as questions, each with a recommendation and, for a clear choice, options).',
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
      },
    },
    ({ verdict, summary, feedback, questions }) =>
      attempt(async () => {
        await options.send('report', {
          token: options.token,
          verdict,
          summary,
          feedback: feedback ?? null,
          questions: questions ?? null,
        });
        return `Recorded verdict ${verdict}. You can stop now.`;
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
          workflow: z.string().min(1).describe('Workflow id of the configuration, e.g. feature'),
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
          skip: z
            .array(z.string())
            .optional()
            .describe('Ids of workflow steps this task skips, e.g. ["review", "qa"]'),
          after: z
            .array(z.string().min(1))
            .optional()
            .describe(
              'Ids of queue items or runs that must be done first, e.g. the ids returned by earlier swarm_queue_add calls',
            ),
        },
      },
      ({ workflow, task, groups, title, autoDeliver, skip, after }) =>
        attempt(async () => {
          if ((task === undefined) === (groups === undefined)) {
            throw new Error('pass either task or groups');
          }
          const result = (await options.send('worker_queue_add', {
            token: options.token,
            workflow,
            ...(task !== undefined ? { task } : {}),
            ...(groups !== undefined ? { groups } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(autoDeliver !== undefined ? { autoDeliver } : {}),
            ...(skip !== undefined ? { skip } : {}),
            ...(after !== undefined ? { after } : {}),
          })) as { item?: string };
          return `Queued ${result.item ?? 'the task'} for workflow ${workflow}. It starts when the queue runs.`;
        }),
    );
  }
  return server;
}
