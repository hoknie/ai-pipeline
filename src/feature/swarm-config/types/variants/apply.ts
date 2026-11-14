import { findPipeline, findSpecialist } from '../lookups.ts';
import { type Split, type Step, type StepAgent, type StepOverride } from '../pipeline.ts';
import { DEFAULT_VARIANT } from '../pipeline.ts';
import { type ResolvedConfig } from '../settings.ts';
import { type Specialist } from '../specialist.ts';
import { findVariant, targetOf } from './lookup.ts';

function overrideStep(step: Step, override: StepOverride): Step {
  return {
    ...step,
    ...(override.specialist !== undefined ? { specialist: override.specialist } : {}),
    ...(override.additionalPrompt !== undefined
      ? { additionalPrompt: override.additionalPrompt }
      : {}),
    ...(override.agent ? { agent: { ...override.agent } } : {}),
  };
}

function overrideSplit(split: Split, override: StepOverride): Split {
  return {
    ...split,
    ...(override.specialist !== undefined ? { specialist: override.specialist } : {}),
    ...(override.additionalPrompt !== undefined
      ? { additionalPrompt: override.additionalPrompt }
      : {}),
    ...(override.agent ? { agent: { ...override.agent } } : {}),
  };
}

/**
 * A copy of the configuration with the variant applied: the split override in the pipeline of the
 * task, the step overrides in the pipeline the groups follow (the variant of the same name there).
 * The skips stay for `applySkip`.
 */
export function applyVariant(
  config: ResolvedConfig,
  pipelineId: string,
  variantId: string,
): ResolvedConfig {
  if (variantId === DEFAULT_VARIANT) return config;
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline) return config;
  const target = targetOf(config, pipeline);
  const own = findVariant(pipeline, variantId);
  const forGroups = findVariant(target, variantId);
  return {
    ...config,
    pipelines: config.pipelines.map((candidate) => {
      let result = candidate;
      if (candidate.id === pipeline.id && own?.split && result.split) {
        result = { ...result, split: overrideSplit(result.split, own.split) };
      }
      if (candidate.id === target.id && forGroups && Object.keys(forGroups.steps).length > 0) {
        result = {
          ...result,
          steps: result.steps.map((step) => {
            const override = forGroups.steps[step.id];
            return override ? overrideStep(step, override) : step;
          }),
        };
      }
      return result;
    }),
  };
}

/** The specialist that runs a step: the specialist of the step with the executor of its override. */
export function stepSpecialist(
  config: ResolvedConfig,
  step: { specialist: string; agent?: StepAgent },
): Specialist | undefined {
  const base = findSpecialist(config, step.specialist);
  const agent = step.agent;
  if (!base || !agent) return base;
  if (agent.runtimeChain !== undefined) {
    const { variant: _variant, reasoningEffort: _effort, ...rest } = base;
    return { ...rest, model: null, runtimeChain: agent.runtimeChain };
  }
  const sets =
    agent.runtime !== undefined ||
    agent.model !== undefined ||
    agent.variant !== undefined ||
    agent.reasoningEffort !== undefined;
  if (!sets) return base;
  const runtime = agent.runtime ?? base.runtime;
  // Options of the specialist belong to its executor: they are not kept when it changes.
  const same = runtime === base.runtime;
  const { variant: baseVariant, reasoningEffort: baseEffort, ...rest } = base;
  const variant = agent.variant ?? (same ? baseVariant : undefined);
  const effort = agent.reasoningEffort ?? (same ? baseEffort : undefined);
  return {
    ...rest,
    runtime,
    runtimeChain: null,
    model: agent.model ?? (same ? base.model : null),
    ...(variant !== undefined ? { variant } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
  };
}
