import { queueRepository } from './queue.ts';
import { z } from 'zod';

const projectName = z.string().trim().min(1).max(80);
const projectSlug = z.string().min(1);
const projectColor = z.string().min(1);

export const repositoriesRequests = [
  z.object({ method: z.literal('repositories'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('repository_add'),
    params: z.object({
      path: queueRepository,
      name: projectName.optional(),
      slug: projectSlug.optional(),
      color: projectColor.optional(),
    }),
  }),
  z.object({
    method: z.literal('repository_update'),
    params: z.object({
      path: queueRepository,
      name: projectName.nullable().optional(),
      slug: projectSlug.optional(),
      enabled: z.boolean().optional(),
      color: projectColor.nullable().optional(),
    }),
  }),
  z.object({
    method: z.literal('repository_move'),
    params: z.object({ path: queueRepository, to: z.string().min(1) }),
  }),
  z.object({ method: z.literal('repository_remove'), params: z.object({ path: queueRepository }) }),
] as const;
