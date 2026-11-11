import { z } from 'zod';

const moment = z.number().int().safe().nonnegative();

const reportParams = z
  .object({
    since: moment.optional(),
    until: moment.optional(),
    repository: z.string().min(1).max(4096).optional(),
  })
  .refine(({ since, until }) => since === undefined || until === undefined || since < until, {
    message: 'since must be less than until',
    path: ['since'],
  });

export const statsRequests = [
  z.object({ method: z.literal('stats_report'), params: reportParams.default({}) }),
  z.object({
    method: z.literal('stats_clear'),
    params: z.object({ repository: z.string().min(1).max(4096) }),
  }),
] as const;
