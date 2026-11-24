import { z } from 'zod';

export const lessonsRequests = [
  z.object({
    method: z.literal('run_lessons'),
    params: z.object({ runId: z.string().min(1) }),
  }),
] as const;
