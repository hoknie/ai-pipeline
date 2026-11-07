import { z } from 'zod';

export const processesRequests = [
  z.object({ method: z.literal('processes'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('process_kill'),
    params: z.object({ pid: z.number().int().positive() }),
  }),
] as const;
