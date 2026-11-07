import { type Action, type ActionPoint } from './action.ts';
import { type Pipeline } from './pipeline.ts';
import { type ResolvedConfig } from './settings.ts';
import { type Specialist } from './specialist.ts';

export function findSpecialist(config: ResolvedConfig, slug: string): Specialist | undefined {
  return config.specialists.find((specialist) => specialist.slug === slug);
}

export function findAction(config: ResolvedConfig, id: string): Action | undefined {
  return (config.actions ?? []).find((action) => action.id === id);
}

/** Ids of the actions of a point of a pipeline: its own list, else the shared one. */
export function pipelineActionIds(
  config: ResolvedConfig,
  pipeline: Pipeline,
  point: ActionPoint,
): string[] {
  if (pipeline.stages?.[point] !== undefined) return pipeline.stages[point];
  // A pipeline without a split has no points around the split.
  if ((point === 'before_split' || point === 'after_split') && pipeline.split === null) return [];
  return config.stages?.[point] ?? [];
}

export function findPipeline(config: ResolvedConfig, id: string): Pipeline | undefined {
  return config.pipelines.find((pipeline) => pipeline.id === id);
}

/** Display name of a pipeline: `name`, else the id. Tolerates snapshots saved before the field existed. */
export function pipelineName(pipeline: Pipeline): string {
  return pipeline.name ?? pipeline.id;
}

/** Display name of the pipeline `id`; the id itself when there is no such pipeline. */
export function pipelineNameOf(config: ResolvedConfig, id: string): string {
  const found = findPipeline(config, id);
  return found ? pipelineName(found) : id;
}

/** The pipeline whose steps the groups of `pipeline` follow. */
export function groupPipeline(config: ResolvedConfig, pipeline: Pipeline): Pipeline {
  // Runs saved before the field existed have no value.
  const target = pipeline.split?.pipeline ?? null;
  if (target === null) return pipeline;
  const found = findPipeline(config, target);
  if (!found) throw new Error(`pipeline ${pipeline.id} splits into unknown pipeline ${target}`);
  return found;
}

export function stepIndex(pipeline: Pipeline, stepId: string): number {
  return pipeline.steps.findIndex((step) => step.id === stepId);
}

/** Slug of the specialist of the observer; it is not a slug of `swarm.yaml` (starts with `_`). */
export const OBSERVER_SPECIALIST = '_observer';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export const SLUG_PATTERN_TEXT = '^[a-z][a-z0-9-]{0,31}$';

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
