import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  ARTIFACT_CONTENT_LIMIT,
  ARTIFACT_FILE_NAME_LIMIT,
  ARTIFACT_TITLE_LIMIT,
  validArtifactFileName,
} from '../../feature/artifacts/types/index.ts';
import {
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  RECOMMENDATION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  SUMMARY_LIMIT,
} from '../../feature/runs/types/index.ts';
import { VERDICTS } from '../../feature/agents/types/index.ts';
import { packageVersion } from '../../platform/build/index.ts';
import { invalid } from '../../platform/errors/index.ts';
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

export function workerKit(options: WorkerOptions) {
  const server = new McpServer({ name: 'aip', version: packageVersion() });
  return { options, server };
}

export type WorkerKit = ReturnType<typeof workerKit>;

export function registerReport(kit: WorkerKit): void {
  const { options, server } = kit;
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
}

export function registerArtifact(kit: WorkerKit): void {
  const { options, server } = kit;
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
          throw invalid('mcp.invalid_arguments', 'pass either content or path');
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
}
