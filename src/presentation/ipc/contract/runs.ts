import { isAbsolute } from 'node:path';

import { RUN_TITLE_LIMIT } from '../../../feature/agents/types/index.ts';
import { DELIVERY_MODES } from '../../../feature/swarm-config/types/index.ts';
import { TAG_NAME_LIMIT } from '../../../feature/tags/types/index.ts';
import { z } from 'zod';

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

const titleSchema = z.string().trim().min(1).max(RUN_TITLE_LIMIT);

export const target = { runId: z.string().min(1), group: z.string().min(1) };

export const proposedGroupSchema = z.object({
  title: z.string().trim().min(1),
  task: z.string().trim().min(1),
});

/** Tag names, as the user sees them; the daemon resolves them to ids. */
export const tagNames = z.array(z.string().trim().min(1).max(TAG_NAME_LIMIT)).max(20);

/** Ids of pipeline steps a task skips. */
export const skipSteps = z.array(z.string().trim().min(1)).max(50);

/** Ids of queue items or runs a task waits for. */
export const afterIds = z.array(z.string().min(1)).max(50);

export const deliveryModeSchema = z.enum(DELIVERY_MODES);

export const parentRef = z.union([z.string().trim().min(1), z.number().int().positive()]);

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

export const runsRequests = [
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
        repository: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), { message: 'repository must be an absolute path' })
          .optional(),
      })
      .default({ limit: 15 }),
  }),
  z.object({
    method: z.literal('run_patch'),
    params: z.object({ runId: z.string().min(1) }),
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
    method: z.literal('run_title'),
    params: z.object({ runId: z.string().min(1), title: titleSchema }),
  }),
  z.object({
    method: z.literal('run_auto_deliver_cancel'),
    params: z.object({ runId: z.string().min(1) }),
  }),
  z.object({ method: z.literal('repair_action'), params: repairActionParams }),
] as const;
