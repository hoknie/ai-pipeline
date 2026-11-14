import { findPipeline, groupPipeline } from '../lookups.ts';
import { DEFAULT_VARIANT, type Pipeline, type PipelineVariant, type Step } from '../pipeline.ts';
import { type ResolvedConfig } from '../settings.ts';

export interface VariantInfo {
  id: string;
  name: string;
  skip: string[];
}

/** The variant `id` described in the pipeline file; `default` is never described. */
export function findVariant(pipeline: Pipeline, id: string): PipelineVariant | undefined {
  return (pipeline.variants ?? []).find((variant) => variant.id === id);
}

/** The pipeline that holds the variants for the groups of `pipeline`: its split target or itself. */
export function targetOf(config: ResolvedConfig, pipeline: Pipeline): Pipeline {
  return pipeline.split?.pipeline ? groupPipeline(config, pipeline) : pipeline;
}

/** Collapses repeats, keeping the order. */
function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/** The error text of a `skip` that does not fit `steps`, or `null`. */
export function skipProblem(steps: readonly Step[], skip: readonly string[]): string | null {
  const wanted = unique(skip);
  if (wanted.length === 0) return null;
  const ids = steps.map((step) => step.id);
  for (const id of wanted) {
    if (!ids.includes(id)) return `unknown step \`${id}\` in skip; steps: ${ids.join(', ')}`;
  }
  const left = steps.filter((step) => !wanted.includes(step.id));
  if (left.length === 0) return 'skip leaves no steps';
  for (const step of left) {
    const goto = step.onReject?.goto;
    if (goto !== undefined && wanted.includes(goto)) {
      return `step \`${step.id}\` returns to skipped step \`${goto}\``;
    }
  }
  return null;
}

/** Ids of the variants of a pipeline: `default` first, then its own, then those of the split target. */
function variantIds(config: ResolvedConfig, pipeline: Pipeline): string[] {
  const target = targetOf(config, pipeline);
  return unique([
    DEFAULT_VARIANT,
    ...(pipeline.variants ?? []).map((variant) => variant.id),
    ...(target === pipeline ? [] : (target.variants ?? []).map((variant) => variant.id)),
  ]);
}

/** `skip` of the variant in the pipeline the groups follow. */
export function variantSkip(
  config: ResolvedConfig,
  pipelineId: string,
  variantId: string,
): string[] {
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline || variantId === DEFAULT_VARIANT) return [];
  const target = targetOf(config, pipeline);
  return [...(findVariant(target, variantId)?.skip ?? [])];
}

/** Name of the variant: its `name`, else the id. */
export function variantNameOf(
  config: ResolvedConfig,
  pipelineId: string,
  variantId: string,
): string {
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline || variantId === DEFAULT_VARIANT) return variantId;
  const own = findVariant(pipeline, variantId);
  const target = pipeline.split?.pipeline ? findPipeline(config, pipeline.split.pipeline) : null;
  const found = own ?? (target ? findVariant(target, variantId) : undefined);
  return found?.name ?? variantId;
}

/** The variants of a pipeline for a view: `default` first, then the rest in the order of the file. */
export function pipelineVariants(config: ResolvedConfig, pipelineId: string): VariantInfo[] {
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline) return [];
  return variantIds(config, pipeline).map((id) => ({
    id,
    name: variantNameOf(config, pipelineId, id),
    skip: variantSkip(config, pipelineId, id),
  }));
}

/** The error text of a variant that the pipeline does not have, or `null`. */
export function checkVariant(
  config: ResolvedConfig,
  pipelineId: string,
  variantId: string,
): string | null {
  const pipeline = findPipeline(config, pipelineId);
  if (!pipeline) return `unknown pipeline \`${pipelineId}\``;
  const known = variantIds(config, pipeline);
  if (known.includes(variantId)) return null;
  return `unknown variant \`${variantId}\` of pipeline \`${pipelineId}\`; known: ${known.join(', ')}`;
}
