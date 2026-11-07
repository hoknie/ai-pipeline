import { z } from 'zod';

import {
  DELIVERY_MODES,
  SLUG_PATTERN_TEXT,
  isValidSlug,
} from '../feature/swarm-config/types/index.ts';
import { settingFieldOf } from '../feature/swarm-edit/types/index.ts';
import {
  ARTIFACT_CONTENT_LIMIT,
  ARTIFACT_FILE_NAME_LIMIT,
  ARTIFACT_TITLE_LIMIT,
  FEEDBACK_LIMIT,
  INCIDENT_KINDS,
  OPTIONS_LIMIT,
  OPTION_LIMIT,
  RECOMMENDATION_LIMIT,
  QUESTIONS_LIMIT,
  QUESTION_TEXT_LIMIT,
  RUN_TITLE_LIMIT,
  SUMMARY_LIMIT,
  TAG_NAME_LIMIT,
  VERDICTS,
  validArtifactFileName,
} from '../core/index.ts';

const repairActionParams = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('answer'),
    token: z.string().min(1),
    group: z.string().min(1),
    answer: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('retry'),
    token: z.string().min(1),
    group: z.string().min(1),
    refreshConfig: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    token: z.string().min(1),
    group: z.string().min(1).optional(),
    reason: z.string().trim().min(1),
  }),
]);

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
  human_only: z.boolean().nullish(),
});

/** Tag names, as the user sees them; the daemon resolves them to ids. */
const tagNames = z.array(z.string().trim().min(1).max(TAG_NAME_LIMIT)).max(20);

/** Ids of pipeline steps a task skips. */
const skipSteps = z.array(z.string().trim().min(1)).max(50);

/** Ids of queue items or runs a task waits for. */
const afterIds = z.array(z.string().min(1)).max(50);

const deliveryModeSchema = z.enum(DELIVERY_MODES);

/** A value of a field of settings.yaml; null removes the field. */
export const settingValueSchema = z
  .union([z.boolean(), z.number(), z.string(), z.array(z.string())])
  .nullable();

/** A path of the catalog of writable fields, also `runtimes.<runtime>.env.<NAME>`. */
const settingPathSchema = z
  .string()
  .min(1)
  .refine((path) => settingFieldOf(path) !== undefined, { message: 'unknown setting' });

const parentRef = z.union([z.string().trim().min(1), z.number().int().positive()]);

const runParams = z
  .object({
    repository: z.string().min(1),
    pipeline: z.string().min(1),
    task: z.string().trim().min(1).optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: z.string().trim().min(1).max(RUN_TITLE_LIMIT).optional(),
    autoDeliver: z.boolean().optional(),
    deliveryMode: deliveryModeSchema.optional(),
    tags: tagNames.optional(),
    parent: parentRef.optional(),
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
    pipeline: z.string().min(1),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.optional(),
    autoDeliver: z.boolean().optional(),
    deliveryMode: deliveryModeSchema.optional(),
    tags: tagNames.optional(),
    parent: parentRef.optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
    postponed: z.boolean().optional(),
  })
  .refine((params) => (params.task === undefined) !== (params.groups === undefined), {
    message: 'pass either task or groups',
  });

/** A task added by a specialist: the repository is the one of the run the token belongs to. */
export const workerQueueAddParams = z
  .object({
    token: z.string().min(1),
    pipeline: z.string().min(1),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.optional(),
    autoDeliver: z.boolean().optional(),
    deliveryMode: deliveryModeSchema.optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
  })
  .refine((params) => (params.task === undefined) !== (params.groups === undefined), {
    message: 'pass either task or groups',
  });

/** A file a specialist publishes outside of git: exactly one of `content` and `path`. */
export const artifactPublishParams = z
  .object({
    token: z.string().min(1),
    fileName: z
      .string()
      .max(ARTIFACT_FILE_NAME_LIMIT)
      .refine(validArtifactFileName, { message: 'not a plain file name' }),
    title: z.string().trim().min(1).max(ARTIFACT_TITLE_LIMIT).optional(),
    content: z.string().max(ARTIFACT_CONTENT_LIMIT).optional(),
    path: z.string().min(1).optional(),
  })
  .refine((params) => (params.content === undefined) !== (params.path === undefined), {
    message: 'pass either content or path',
  });

const queueEditParams = z
  .object({
    repository: queueRepository,
    item: queueItem,
    pipeline: z.string().min(1).optional(),
    task: queueTask.optional(),
    groups: z.array(proposedGroupSchema).min(1).optional(),
    title: queueTitle.nullable().optional(),
    autoDeliver: z.boolean().nullable().optional(),
    deliveryMode: deliveryModeSchema.nullable().optional(),
    tags: tagNames.optional(),
    parent: parentRef.nullable().optional(),
    skip: skipSteps.optional(),
    after: afterIds.optional(),
    postponed: z.boolean().optional(),
    position: z.number().int().min(1).optional(),
  })
  .refine((params) => params.task === undefined || params.groups === undefined, {
    message: 'pass either task or groups',
  });

const queueParallel = z.number().int().min(1).max(20);
export const entryIdSchema = z
  .string()
  .refine(isValidSlug, { message: `id must match ${SLUG_PATTERN_TEXT}` });

const entryKindSchema = z.enum(['specialist', 'pipeline', 'action']);
/** Repository of the project level; null is the shared level. */
const levelRepository = z.string().min(1).nullable();
const writeLevelSchema = z.enum(['project', 'global']);

/** Longest message a human can send to a running specialist. */
export const MESSAGE_TEXT_LIMIT = 20_000;

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
    method: z.literal('finished_runs'),
    params: z
      .object({
        limit: z.number().int().min(1).max(100).default(15),
        before: z.string().min(1).optional(),
      })
      .default({ limit: 15 }),
  }),
  z.object({
    method: z.literal('group'),
    params: z.object({ ...target, tailLines: z.number().int().min(1).max(500).optional() }),
  }),
  z.object({ method: z.literal('group_spec'), params: z.object(target) }),
  z.object({
    method: z.literal('group_file_diff'),
    params: z.object({ ...target, path: z.string().min(1) }),
  }),
  z.object({ method: z.literal('group_artifacts'), params: z.object(target) }),
  z.object({
    method: z.literal('artifact'),
    params: z.object({ ...target, id: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('run_patch'),
    params: z.object({ runId: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('pipelines'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('system_stages'),
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
      path: settingPathSchema,
      value: settingValueSchema,
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.default('global'),
    }),
  }),
  z.object({
    method: z.literal('config_settings'),
    params: z.object({
      repository: z.string().min(1),
      values: z
        .record(settingPathSchema, settingValueSchema)
        .refine((values) => Object.keys(values).length > 0, {
          message: 'values must not be empty',
        }),
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.default('global'),
    }),
  }),
  z.object({
    method: z.literal('config_preview'),
    params: z.object({
      repository: z.string().min(1),
      kind: z.literal('pipeline'),
      id: entryIdSchema,
      value: z.record(z.string(), z.unknown()),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('specialist_tags'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('shared_specialists'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('specialist_tags_set'),
    params: z.object({
      repository: levelRepository,
      slug: entryIdSchema,
      tags: z.array(z.string()),
      revision: z.string().min(1).nullable(),
    }),
  }),
  z.object({
    method: z.literal('specialist_tag_rename'),
    params: z.object({
      repository: levelRepository,
      from: z.string().min(1),
      to: z.string().min(1),
    }),
  }),
  z.object({
    method: z.literal('specialist_tag_remove'),
    params: z.object({ repository: levelRepository, tag: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('specialists_import'),
    params: z.object({
      repository: z.string().min(1),
      source: z.string().min(1),
      slugs: z.array(entryIdSchema).min(1),
    }),
  }),
  z.object({
    method: z.literal('shared_pipelines'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('pipelines_import'),
    params: z.object({
      repository: z.string().min(1),
      source: z.string().min(1),
      ids: z.array(entryIdSchema).min(1),
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
  z.object({
    method: z.literal('retry'),
    params: z.object({ ...target, refreshConfig: z.boolean().optional() }),
  }),
  z.object({
    method: z.literal('run_skip'),
    params: z.object({
      runId: z.string().min(1),
      step: z.string().min(1),
      skip: z.boolean(),
    }),
  }),
  z.object({
    method: z.literal('apply'),
    params: z.object({
      runId: z.string().min(1),
      groups: z.array(z.string().min(1)).optional(),
      force: z.boolean().optional(),
    }),
  }),
  z.object({
    method: z.literal('run_mark_delivered'),
    params: z.object({
      runId: z.string().min(1),
      groups: z.array(z.string().min(1)).optional(),
    }),
  }),
  z.object({
    method: z.literal('answer'),
    params: z.object({ ...target, answer: z.string().trim().min(1) }),
  }),
  z.object({
    method: z.literal('message'),
    params: z.object({
      ...target,
      seq: z.number().int().positive(),
      text: z.string().trim().min(1).max(MESSAGE_TEXT_LIMIT),
    }),
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
    params: z
      .object({
        repository: queueRepository,
        parallel: queueParallel.optional(),
        autopilot: z.boolean().optional(),
        autoAnswer: z.boolean().optional(),
        skipFailed: z.boolean().optional(),
        autopilotAnswer: z.string().trim().min(1).max(RECOMMENDATION_LIMIT).nullable().optional(),
        // Checked by the queue, so an unknown value gets its own error.
        onLimit: z.string().optional(),
      })
      .refine(
        (params) =>
          params.parallel !== undefined ||
          params.autopilot !== undefined ||
          params.autoAnswer !== undefined ||
          params.skipFailed !== undefined ||
          params.autopilotAnswer !== undefined ||
          params.onLimit !== undefined,
        { message: 'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed or onLimit' },
      ),
  }),
  z.object({
    method: z.literal('queue_return'),
    params: z.object({ runId: z.string().min(1), repository: queueRepository.optional() }),
  }),
  z.object({
    method: z.literal('run_pause'),
    params: z.object({ runId: z.string().min(1), repository: queueRepository.optional() }),
  }),
  z.object({
    method: z.literal('queue_dismiss'),
    params: z.object({ runId: z.string().min(1), repository: queueRepository.optional() }),
  }),
  z.object({
    method: z.literal('queue_run_now'),
    params: z.object({ repository: queueRepository, item: queueItem }),
  }),
  z.object({ method: z.literal('tags'), params: z.object({ repository: queueRepository }) }),
  z.object({
    method: z.literal('tag_add'),
    params: z.object({
      repository: queueRepository,
      name: z.string(),
      color: z.string().optional(),
    }),
  }),
  z.object({
    method: z.literal('tag_edit'),
    params: z
      .object({
        repository: queueRepository,
        tag: z.string().min(1),
        name: z.string().optional(),
        color: z.string().optional(),
      })
      .refine((params) => params.name !== undefined || params.color !== undefined, {
        message: 'pass a new name or a new color',
      }),
  }),
  z.object({
    method: z.literal('tag_remove'),
    params: z.object({ repository: queueRepository, tag: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('run_tags'),
    params: z
      .object({ runId: z.string().min(1), add: tagNames.optional(), remove: tagNames.optional() })
      .refine((params) => (params.add?.length ?? 0) + (params.remove?.length ?? 0) > 0, {
        message: 'pass tags to add or remove',
      }),
  }),
  z.object({
    method: z.literal('run_title'),
    params: z.object({ runId: z.string().min(1), title: queueTitle }),
  }),
  z.object({ method: z.literal('observers'), params: z.object({}).default({}) }),
  z.object({
    // The shape only: the daemon checks the values, so a mistake comes back as field errors.
    method: z.literal('observers_set'),
    params: z.object({ settings: z.record(z.string(), z.unknown()) }),
  }),
  z.object({
    method: z.literal('run_observer'),
    params: z.object({ runId: z.string().min(1), enabled: z.boolean() }),
  }),
  z.object({ method: z.literal('repair_action'), params: repairActionParams }),
  z.object({ method: z.literal('processes'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('process_kill'),
    params: z.object({ pid: z.number().int().positive() }),
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
  z.object({ method: z.literal('artifact_publish'), params: artifactPublishParams }),
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
    repository: z.string().optional(),
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
  z.object({ event: z.literal('observers'), seq: z.number().int(), observers: z.looseObject({}) }),
  z.object({
    event: z.literal('incident'),
    seq: z.number().int(),
    runId: z.string(),
    repository: z.string(),
    incident: z.object({
      key: z.string(),
      kind: z.enum(INCIDENT_KINDS),
      group: z.string(),
      detail: z.string(),
    }),
  }),
  z.object({
    event: z.literal('processes'),
    seq: z.number().int(),
    processes: z.array(z.looseObject({ pid: z.number() })).optional(),
    error: z.string().optional(),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
export type BackgroundProcessesStreamEvent = Extract<StreamEvent, { event: 'processes' }>;
