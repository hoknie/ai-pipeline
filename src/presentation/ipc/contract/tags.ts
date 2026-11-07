import { queueRepository } from './queue.ts';
import { tagNames } from './runs.ts';
import { z } from 'zod';

export const tagsRequests = [
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
] as const;
