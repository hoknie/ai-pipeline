import { RUNTIMES } from '../../../../feature/swarm-config/types/index.ts';
import { z } from 'zod';

const historyParams = z
  .object({
    repository: z.string().min(1).max(4096).optional(),
    runtime: z.enum(RUNTIMES).optional(),
    model: z.string().min(1).max(512).optional(),
    result: z
      .enum(['running', 'done', 'rejected', 'needs_human', 'failed', 'cancelled', 'unknown'])
      .optional(),
    from: z.number().int().safe().nonnegative().optional(),
    to: z.number().int().safe().nonnegative().optional(),
    limit: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from < to, {
    message: 'from must be less than to',
    path: ['to'],
  });

export const observerHistoryRequests = [
  z.object({
    method: z.literal('observers_history'),
    params: historyParams.default({ limit: 20 }),
  }),
] as const;
