import { z } from 'zod';

import { SETTABLE_SETTINGS, SLUG_PATTERN_TEXT, isValidSlug } from '../config/index.ts';
import {
  FEEDBACK_LIMIT,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  RECOMMENDATION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RUN_TITLE_LIMIT,
  SUMMARY_LIMIT,
  TAG_NAME_LIMIT,
  VERDICTS,
} from '../core/index.ts';

export const proposedGroupSchema = z.object({
  title: z.string().trim().min(1),
  task: z.string().trim().min(1),
});

export const humanQuestionSchema = z.object({
  text: z.string().trim().min(1).max(QUESTION_TEXT_LIMIT),
  options: z.array(z.string().trim().min(1).max(OPTION_LIMIT)).min(1).max(OPTIONS_LIMIT).nullish(),
  recommendation: z.string().trim().min(1).max(RECOMMENDATION_LIMIT).nullish(),
});

export const reportParamsSchema = z.object({
  token: z.string().min(1),
  verdict: z.enum(VERDICTS),
  summary: z.string().min(1).max(SUMMARY_LIMIT),
  feedback: z.string().max(FEEDBACK_LIMIT).nullish(),
  questions: z.array(humanQuestionSchema).min(1).max(QUESTIONS_LIMIT).nullish(),
});

/** Tag names, as the user sees them; the daemon resolves them to ids. */
const tagNames = z.array(z.string().trim().min(1).max(TAG_NAME_LIMIT)).max(20);

/** Ids of workflow steps a task skips. */
const skipSteps = z.array(z.string().trim().min(1)).max(50);

/** Ids of queue items or runs a task waits for. */
const afterIds = z.array(z.string().min(1)).max(50);

const runParams = z
  .object({
    repository: z.string().min(1),
    workflow: z.string().min(1),
    task: z.string().trim().min(1).optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: z.string().trim().min(1).max(RUN_TITLE_LIMIT).optional(),
    autoDeliver: z.boolean().optional(),
    tags: tagNames.optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
  })
  .refine((params) => (params.task === undefined) !== (params.groups === undefined), {
    message: 'pass either task or groups',
  });

const queueRepository = z.string().min(1);
const queueItem = z.string().min(1);
const queueTask = z.string().trim().min(1);
const queueTitle = z.string().trim().min(1).max(RUN_TITLE_LIMIT);

const queueAddParams = z
  .object({
    repository: queueRepository,
    workflow: z.string().min(1),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.optional(),
    autoDeliver: z.boolean().optional(),
    tags: tagNames.optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
  })
  .refine((params) => (params.task === undefined) !== (params.groups === undefined), {
    message: 'pass either task or groups',
  });

/** A task added by a specialist: the repository is the one of the run the token belongs to. */
export const workerQueueAddParams = z
  .object({
    token: z.string().min(1),
    workflow: z.string().min(1),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.optional(),
    autoDeliver: z.boolean().optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
  })
  .refine((params) => (params.task === undefined) !== (params.groups === undefined), {
    message: 'pass either task or groups',
  });

const queueEditParams = z
  .object({
    repository: queueRepository,
    item: queueItem,
    workflow: z.string().min(1).optional(),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.nullable().optional(),
    autoDeliver: z.boolean().nullable().optional(),
    tags: tagNames.optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
    position: z.number().int().min(1).optional(),
  })
  .refine((params) => params.task === undefined || params.groups === undefined, {
    message: 'pass either task or groups',
  });

const queueParallel = z.number().int().min(1).max(20);
export const entryIdSchema = z
  .string()
  .refine(isValidSlug, { message: `id must match ${SLUG_PATTERN_TEXT}` });

const entryKindSchema = z.enum(['specialist', 'workflow']);
const writeLevelSchema = z.enum(['project', 'global']);

const target = { runId: z.string().min(1), group: z.string().min(1) };

export const requestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('ping'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('shutdown'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('shutdown_idle'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('subscribe'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('run'), params: runParams }),
  z.object({
    method: z.literal('status'),
    params: z.object({ runId: z.string().min(1).optional() }).default({}),
  }),
  z.object({
    method: z.literal('group'),
    params: z.object({ ...target, tailLines: z.number().int().min(1).max(500).optional() }),
  }),
  z.object({
    method: z.literal('workflows'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config_catalog'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config_write'),
    params: z.object({
      repository: z.string().min(1),
      kind: entryKindSchema,
      id: entryIdSchema,
      value: z.record(z.string(), z.unknown()),
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('config_setting'),
    params: z.object({
      repository: z.string().min(1),
      path: z.enum(SETTABLE_SETTINGS),
      value: z.boolean().nullable(),
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.default('global'),
    }),
  }),
  z.object({
    method: z.literal('config_preview'),
    params: z.object({
      repository: z.string().min(1),
      kind: z.literal('workflow'),
      id: entryIdSchema,
      value: z.record(z.string(), z.unknown()),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('config_delete'),
    params: z.object({
      repository: z.string().min(1),
      kind: entryKindSchema,
      id: entryIdSchema,
      revision: z.string().min(1),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('transcript'),
    params: z.object({
      ...target,
      seq: z.number().int().min(1).optional(),
      after: z.number().int().min(0).optional(),
    }),
  }),
  z.object({
    method: z.literal('cancel'),
    params: z.object({ runId: z.string().min(1), group: z.string().min(1).optional() }),
  }),
  z.object({ method: z.literal('retry'), params: z.object(target) }),
  z.object({
    method: z.literal('apply'),
    params: z.object({
      runId: z.string().min(1),
      groups: z.array(z.string().min(1)).optional(),
      force: z.boolean().optional(),
    }),
  }),
  z.object({
    method: z.literal('answer'),
    params: z.object({ ...target, answer: z.string().trim().min(1) }),
  }),
  z.object({ method: z.literal('queue'), params: z.object({ repository: queueRepository }) }),
  z.object({ method: z.literal('repositories'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('repository_add'), params: z.object({ path: queueRepository }) }),
  z.object({ method: z.literal('repository_remove'), params: z.object({ path: queueRepository }) }),
  z.object({ method: z.literal('queue_add'), params: queueAddParams }),
  z.object({ method: z.literal('queue_edit'), params: queueEditParams }),
  z.object({
    method: z.literal('queue_remove'),
    params: z.object({ repository: queueRepository, item: queueItem }),
  }),
  z.object({
    method: z.literal('queue_start'),
    params: z.object({ repository: queueRepository, parallel: queueParallel.optional() }),
  }),
  z.object({ method: z.literal('queue_pause'), params: z.object({ repository: queueRepository }) }),
  z.object({
    method: z.literal('queue_settings'),
    params: z.object({ repository: queueRepository, parallel: queueParallel }),
  }),
  z.object({
    method: z.literal('queue_run_now'),
    params: z.object({ repository: queueRepository, item: queueItem }),
  }),
  z.object({ method: z.literal('tags'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('tag_add'),
    params: z.object({ name: z.string(), color: z.string().optional() }),
  }),
  z.object({
    method: z.literal('tag_edit'),
    params: z
      .object({
        tag: z.string().min(1),
        name: z.string().optional(),
        color: z.string().optional(),
      })
      .refine((params) => params.name !== undefined || params.color !== undefined, {
        message: 'pass a new name or a new color',
      }),
  }),
  z.object({ method: z.literal('tag_remove'), params: z.object({ tag: z.string().min(1) }) }),
  z.object({
    method: z.literal('run_tags'),
    params: z
      .object({
        runId: z.string().min(1),
        add: tagNames.optional(),
        remove: tagNames.optional(),
      })
      .refine((params) => (params.add?.length ?? 0) + (params.remove?.length ?? 0) > 0, {
        message: 'pass tags to add or remove',
      }),
  }),
  z.object({ method: z.literal('web_status'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('web_start'),
    params: z
      .object({
        token: z
          .string()
          .regex(/^[A-Za-z0-9_-]{16,128}$/)
          .optional(),
        restart: z.boolean().optional(),
      })
      .default({}),
  }),
  z.object({ method: z.literal('web_stop'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('report'), params: reportParamsSchema }),
  z.object({ method: z.literal('worker_queue_add'), params: workerQueueAddParams }),
  z.object({
    method: z.literal('split'),
    params: z.object({ token: z.string().min(1), groups: z.array(proposedGroupSchema) }),
  }),
]);

export type Request = z.infer<typeof requestSchema>;
export type Method = Request['method'];
export type ParamsOf<M extends Method> = Extract<Request, { method: M }>['params'];

export const buildInfoSchema = z.object({
  version: z.string(),
  fingerprint: z.string(),
  builtAt: z.number(),
});

/** Answer to `ping`; a daemon older than the build check answers without `build` and `busy`. */
export const pingResultSchema = z.object({
  pong: z.literal(true),
  pid: z.number().int().optional(),
  build: buildInfoSchema.optional(),
  busy: z.boolean().optional(),
});

export type PingResult = z.infer<typeof pingResultSchema>;

/** Answer to `shutdown_idle`: the daemon stops only when no agent runs and nothing merges. */
export const shutdownIdleResultSchema = z.object({ stopping: z.boolean() });

/** Answer to `web_status`: the panel the daemon serves. */
export const webStatusResultSchema = z.object({
  running: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  auth: z.enum(['token', 'none']).nullable(),
  url: z.string().nullable(),
  /** Why the panel is not running, when a start failed or the daemon serves none. */
  reason: z.string().nullable(),
  /** The panel was stopped by `aip web stop` and stays so until the next start. */
  stopped: z.boolean(),
});

export type WebStatusResult = z.infer<typeof webStatusResultSchema>;

export const webStartResultSchema = z.object({
  state: z.enum(['started', 'already_running', 'restarted']),
  status: webStatusResultSchema,
});

export type WebStartResult = z.infer<typeof webStartResultSchema>;

export const webStopResultSchema = z.object({ state: z.enum(['stopped', 'not_running']) });

export type WebStopResult = z.infer<typeof webStopResultSchema>;

export const envelopeSchema = z.object({ id: z.number().int() }).loose();

export type Response =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export const responseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }),
]);

export function parseRequest(
  line: string,
): { id: number; request: Request } | { id: number; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { id: -1, error: 'invalid JSON' };
  }
  const envelope = envelopeSchema.safeParse(value);
  const id = envelope.success ? envelope.data.id : -1;
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return { id, error: z.prettifyError(parsed.error) };
  return { id, request: parsed.data };
}

export const streamEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('snapshot'),
    seq: z.number().int(),
    runs: z.array(z.looseObject({ id: z.string() })),
    queues: z.array(z.looseObject({ repository: z.string() })).optional(),
    repositories: z.array(z.looseObject({ path: z.string() })).optional(),
    tags: z.array(z.looseObject({ id: z.string() })).optional(),
  }),
  z.object({
    event: z.literal('tags'),
    seq: z.number().int(),
    tags: z.array(z.looseObject({ id: z.string() })),
  }),
  z.object({
    event: z.literal('repositories'),
    seq: z.number().int(),
    repositories: z.array(z.looseObject({ path: z.string() })),
  }),
  z.object({
    event: z.literal('queue'),
    seq: z.number().int(),
    queue: z.looseObject({ repository: z.string() }),
  }),
  z.object({
    event: z.literal('run'),
    seq: z.number().int(),
    run: z.looseObject({ id: z.string() }),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
