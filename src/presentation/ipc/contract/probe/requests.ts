import { z } from 'zod';

export const probeRequests = [
  z.object({
    method: z.literal('run_contrast'),
    params: z.object({
      runId: z.string().min(1),
      /** The work group whose task is probed; the first one when absent. */
      group: z.string().min(1).optional(),
      /** Variants of the pipeline in the order of the experiment; the first one is the baseline. */
      candidates: z.array(z.string().trim().min(1)).min(2),
      repetitions: z.number().int().min(1),
      /** The hard limit of runs of the experiment; a plan above it is refused. */
      maxRuns: z.number().int().min(1),
      /** The soft limit of tokens; reached before the next repetition, no further probe is created. */
      maxTokens: z.number().int().min(1).nullable().optional(),
    }),
  }),
  z.object({
    method: z.literal('contrast_show'),
    params: z.object({ id: z.string().min(1) }),
  }),
] as const;
