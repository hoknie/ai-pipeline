import type { HandlerTable } from './types.ts';

/** The lessons of a run: what its specialists should learn from earlier runs of the repository. */
export const lessonsHandlers = {
  run_lessons: async (params, { services }) =>
    services.runs.lessons.summary(services.runs.states.get(params.runId)),
} satisfies Partial<HandlerTable>;
