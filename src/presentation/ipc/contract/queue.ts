import { RUN_TITLE_LIMIT } from '../../../feature/agents/types/index.ts';
import { RECOMMENDATION_LIMIT } from '../../../feature/runs/types/index.ts';
import {
  afterIds,
  deliveryModeSchema,
  parentRef,
  proposedGroupSchema,
  skipSteps,
  tagNames,
} from './runs.ts';
import { z } from 'zod';

export const queueRepository = z.string().min(1);

const queueItem = z.string().min(1);

const queueTask = z.string().trim().min(1);

export const queueTitle = z.string().trim().min(1).max(RUN_TITLE_LIMIT);

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

export const queueRequests = [
  z.object({ method: z.literal('queue'), params: z.object({ repository: queueRepository }) }),
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
        filter: z
          .object({
            pipelines: z.array(z.string().min(1)).max(50).optional(),
            tags: z.array(z.string().min(1)).max(50).optional(),
          })
          .strict()
          .optional(),
      })
      .refine(
        (params) =>
          params.parallel !== undefined ||
          params.autopilot !== undefined ||
          params.autoAnswer !== undefined ||
          params.skipFailed !== undefined ||
          params.autopilotAnswer !== undefined ||
          params.onLimit !== undefined ||
          params.filter !== undefined,
        {
          message:
            'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
        },
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
  z.object({ method: z.literal('worker_queue_add'), params: workerQueueAddParams }),
] as const;
