import type { HandlerTable } from '../types.ts';

/** Contrast probes: the same task on the same base with several variants of the harness. */
export const probeHandlers = {
  run_contrast: async (params, { services }) => services.runs.probes.start(params),
  contrast_show: async (params, { services }) => services.runs.probes.show(params.id),
} satisfies Partial<HandlerTable>;
