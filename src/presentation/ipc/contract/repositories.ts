import { queueRepository } from './queue.ts';
import { z } from 'zod';

export const repositoriesRequests = [
  z.object({ method: z.literal('repositories'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('repository_add'), params: z.object({ path: queueRepository }) }),
  z.object({ method: z.literal('repository_remove'), params: z.object({ path: queueRepository }) }),
] as const;
