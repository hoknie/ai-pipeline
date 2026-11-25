import {
  type ResolvedConfig,
  findPipeline,
  groupPipeline,
  variantSkip,
} from '../../../swarm-config/types/index.ts';
import type { RunState } from '../run.ts';
import { cleanSkip } from '../skip.ts';

/**
 * The steps the source run does not run: the skips fixed when it was created (the steps its
 * snapshot lacks, without those its own variant skipped) and the ones made after the start. The
 * probes repeat every one of them, so their input keeps the step set of the source.
 */
export function sourceSkip(config: ResolvedConfig, state: RunState): string[] {
  const afterStart = state.run.skippedSteps;
  const current = findPipeline(config, state.run.pipeline);
  const source = findPipeline(state.run.config, state.run.pipeline);
  if (!current || !source) return cleanSkip(afterStart);
  const ran = new Set(groupPipeline(state.run.config, source).steps.map((step) => step.id));
  const byVariant = new Set(variantSkip(state.run.config, state.run.pipeline, state.run.variant));
  const atCreation = groupPipeline(config, current)
    .steps.map((step) => step.id)
    .filter((id) => !ran.has(id) && !byVariant.has(id));
  return cleanSkip([...atCreation, ...afterStart]);
}
