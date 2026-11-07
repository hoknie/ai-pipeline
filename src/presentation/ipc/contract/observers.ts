import { z } from 'zod';

export const observersRequests = [
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
] as const;
