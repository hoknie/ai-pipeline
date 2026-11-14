import {
  type ValidateContext,
  addError,
  join,
  readChoice,
  readEntries,
  readKnown,
  readMapping,
  readString,
  readStrings,
} from '../validate-context.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../../types/lookups.ts';
import {
  DEFAULT_VARIANT,
  type Pipeline,
  type PipelineVariant,
  type StepAgent,
  type StepOverride,
} from '../../types/pipeline.ts';
import { type ResolvedConfig } from '../../types/settings.ts';
import {
  REASONING_EFFORTS,
  RUNTIMES,
  modelIdProblem,
  variantProblem,
} from '../../types/specialist.ts';
import { skipProblem, stepSpecialist } from '../../types/variants/index.ts';

const VARIANT_KEYS = ['name', 'skip', 'split', 'steps'];

const OVERRIDE_KEYS = [
  'specialist',
  'runtime',
  'model',
  'variant',
  'reasoning_effort',
  'runtime_chain',
  'additional_prompt',
];

const CHAIN_CONFLICTS = ['runtime', 'model', 'variant', 'reasoning_effort'] as const;

/** Reads the `variants` of a pipeline whose steps and split are already read. */
export function checkVariants(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  pipeline: Pipeline,
  known: string[],
): PipelineVariant[] {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return [];
  return readEntries(ctx, mapping, path, null).map(([id, field]) => {
    const variantPath = join(path, id);
    if (id === DEFAULT_VARIANT) {
      addError(ctx, variantPath, '`default` is reserved: it is the pipeline as it is');
    } else if (!isValidSlug(id)) {
      addError(ctx, variantPath, `id must match ${SLUG_PATTERN_TEXT}`);
    }
    return checkVariant(ctx, id, field, variantPath, pipeline, known);
  });
}

function checkVariant(
  ctx: ValidateContext,
  id: string,
  value: unknown,
  path: string,
  pipeline: Pipeline,
  known: string[],
): PipelineVariant {
  const variant: PipelineVariant = { id, name: null, skip: [], split: null, steps: {} };
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return variant;
  const delegated = Boolean(pipeline.split?.pipeline);
  for (const [key, field] of readEntries(ctx, mapping, path, VARIANT_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'name') variant.name = readString(ctx, field, fieldPath)?.trim() ?? null;
    if (key === 'skip') {
      if (delegated) {
        addError(ctx, fieldPath, 'must not be set for a pipeline with `split.pipeline`');
        continue;
      }
      variant.skip = [...new Set(readStrings(ctx, field, fieldPath))];
      const problem = skipProblem(pipeline.steps, variant.skip);
      if (problem) addError(ctx, fieldPath, problem);
    }
    if (key === 'split') {
      if (pipeline.split === null) {
        addError(ctx, fieldPath, 'the pipeline has no `split`');
        continue;
      }
      variant.split = checkOverride(ctx, field, fieldPath, known);
    }
    if (key === 'steps') {
      if (delegated) {
        addError(ctx, fieldPath, 'must not be set for a pipeline with `split.pipeline`');
        continue;
      }
      variant.steps = checkStepOverrides(ctx, field, fieldPath, pipeline, known);
    }
  }
  return variant;
}

function checkStepOverrides(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  pipeline: Pipeline,
  known: string[],
): Record<string, StepOverride> {
  const result: Record<string, StepOverride> = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return result;
  const ids = pipeline.steps.map((step) => step.id);
  for (const [stepId, field] of readEntries(ctx, mapping, path, null)) {
    const stepPath = join(path, stepId);
    if (!ids.includes(stepId)) {
      addError(ctx, stepPath, `unknown step \`${stepId}\`; steps: ${ids.join(', ')}`);
      continue;
    }
    result[stepId] = checkOverride(ctx, field, stepPath, known);
  }
  return result;
}

function checkOverride(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  known: string[],
): StepOverride {
  const override: StepOverride = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return override;
  const agent: StepAgent = {};
  for (const [key, field] of readEntries(ctx, mapping, path, OVERRIDE_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'specialist')
      override.specialist = readKnown(ctx, field, fieldPath, known) ?? undefined;
    if (key === 'runtime') {
      agent.runtime = readChoice(ctx, field, fieldPath, RUNTIMES) ?? undefined;
    }
    if (key === 'model') agent.model = readString(ctx, field, fieldPath) ?? undefined;
    if (key === 'variant') agent.variant = readString(ctx, field, fieldPath)?.trim();
    if (key === 'reasoning_effort') {
      agent.reasoningEffort = readChoice(ctx, field, fieldPath, REASONING_EFFORTS) ?? undefined;
    }
    if (key === 'runtime_chain')
      agent.runtimeChain = readString(ctx, field, fieldPath) ?? undefined;
    if (key === 'additional_prompt') {
      override.additionalPrompt = field === null ? null : readString(ctx, field, fieldPath);
    }
  }
  if ('runtime_chain' in mapping) {
    for (const conflict of CHAIN_CONFLICTS) {
      if (conflict in mapping) {
        addError(ctx, join(path, conflict), 'cannot be combined with runtime_chain');
      }
    }
  }
  const defined = Object.fromEntries(
    Object.entries(agent).filter(([, item]) => item !== undefined),
  ) as StepAgent;
  if (Object.keys(defined).length > 0) override.agent = defined;
  return override;
}

/** Checks of the overrides that need the whole configuration: chains and the final executor. */
export function checkVariantTargets(ctx: ValidateContext, config: ResolvedConfig): void {
  const chains = config.chains.map((chain) => chain.slug);
  for (const pipeline of config.pipelines) {
    for (const variant of pipeline.variants ?? []) {
      const base = `swarm.pipelines.${pipeline.id}.variants.${variant.id}`;
      if (variant.split && pipeline.split) {
        checkOverrideAgent(
          ctx,
          config,
          join(base, 'split'),
          pipeline.split.specialist,
          variant.split,
          chains,
        );
      }
      for (const [stepId, override] of Object.entries(variant.steps)) {
        const step = pipeline.steps.find((candidate) => candidate.id === stepId);
        if (!step) continue;
        checkOverrideAgent(
          ctx,
          config,
          join(join(base, 'steps'), stepId),
          step.specialist,
          override,
          chains,
        );
      }
    }
  }
}

function checkOverrideAgent(
  ctx: ValidateContext,
  config: ResolvedConfig,
  path: string,
  stepSpecialistSlug: string,
  override: StepOverride,
  chains: string[],
): void {
  const agent = override.agent;
  if (!agent) return;
  if (agent.runtimeChain !== undefined && !chains.includes(agent.runtimeChain)) {
    const hint = chains.length > 0 ? `; known: ${chains.join(', ')}` : '; none defined';
    addError(ctx, join(path, 'runtime_chain'), `unknown chain \`${agent.runtimeChain}\`${hint}`);
    return;
  }
  if (agent.runtimeChain !== undefined) return;
  const final = stepSpecialist(config, {
    specialist: override.specialist ?? stepSpecialistSlug,
    agent,
  });
  if (!final) return;
  const modelProblem =
    agent.model !== undefined ? modelIdProblem(final.runtime, agent.model) : null;
  if (modelProblem) addError(ctx, join(path, 'model'), modelProblem);
  for (const key of ['variant', 'reasoning_effort'] as const) {
    const set =
      key === 'variant' ? agent.variant !== undefined : agent.reasoningEffort !== undefined;
    if (set && final.runtime !== 'opencode') {
      addError(ctx, join(path, key), 'is supported by the opencode runtime only');
    }
  }
  if (agent.variant !== undefined) {
    const problem = variantProblem(final.runtime, final.model, final.variant);
    if (problem) addError(ctx, join(path, 'variant'), problem);
  }
}
