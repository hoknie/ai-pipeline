import type { Pipeline, StepOverride } from '../../../feature/swarm-config/types/index.ts';

/** The variants of a pipeline as `aip config check` prints them: the file keys, only what is set. */
function presentOverride(override: StepOverride): unknown {
  const agent = override.agent;
  return {
    ...(override.specialist !== undefined ? { specialist: override.specialist } : {}),
    ...(agent?.runtime !== undefined ? { runtime: agent.runtime } : {}),
    ...(agent?.model !== undefined ? { model: agent.model } : {}),
    ...(agent?.variant !== undefined ? { variant: agent.variant } : {}),
    ...(agent?.reasoningEffort !== undefined ? { reasoning_effort: agent.reasoningEffort } : {}),
    ...(agent?.runtimeChain !== undefined ? { runtime_chain: agent.runtimeChain } : {}),
    ...(override.additionalPrompt !== undefined
      ? { additional_prompt: override.additionalPrompt }
      : {}),
  };
}

export function presentVariants(pipeline: Pipeline): unknown {
  return Object.fromEntries(
    (pipeline.variants ?? []).map((variant) => [
      variant.id,
      {
        ...(variant.name ? { name: variant.name } : {}),
        ...(variant.skip.length > 0 ? { skip: variant.skip } : {}),
        ...(variant.split ? { split: presentOverride(variant.split) } : {}),
        ...(Object.keys(variant.steps).length > 0
          ? {
              steps: Object.fromEntries(
                Object.entries(variant.steps).map(([id, override]) => [
                  id,
                  presentOverride(override),
                ]),
              ),
            }
          : {}),
      },
    ]),
  );
}
