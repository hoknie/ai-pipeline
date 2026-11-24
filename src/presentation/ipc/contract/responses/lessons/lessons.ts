import { z } from 'zod';

import { LESSON_KINDS } from '../../../../../feature/runs/types/index.ts';

const evidence = z.object({
  occurrences: z.number().int(),
  tasks: z.array(z.number().int()),
  seenAt: z.number(),
});

const lesson = z.object({
  id: z.string(),
  kind: z.enum(LESSON_KINDS),
  text: z.string(),
  evidence,
  priority: z.number(),
});

const specialist = z.object({
  specialist: z.string(),
  attempts: z.number().int(),
  verdicts: z.object({
    done: z.number().int(),
    rejected: z.number().int(),
    needs_human: z.number().int(),
    failed: z.number().int(),
  }),
  denials: z.number().int(),
  outsideChanges: z.number().int(),
  deliveryFailures: z.number().int(),
  lessons: z.array(lesson),
  block: z.string(),
  dropped: z.number().int(),
});

/** The answer of `run_lessons`; the type is `LessonSummary` of the `runs` feature. */
export const lessonSummarySchema = z.object({
  runId: z.string(),
  repository: z.string(),
  specialists: z.array(specialist),
});

export type LessonSummaryView = z.infer<typeof lessonSummarySchema>;
