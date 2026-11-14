import { type StagePoints } from './action.ts';
import type { ReasoningEffort, Runtime } from './specialist.ts';

export const MAX_GROUPS_RANGE = [1, 20] as const;

export const DEFAULT_MAX_GROUPS = 5;

export const MAX_ROUNDS_RANGE = [1, 10] as const;

/** The variant every pipeline has: the pipeline as it is. It cannot be described in `variants`. */
export const DEFAULT_VARIANT = 'default';

/** Executor fields a variant sets for one step; the rest comes from the specialist. */
export interface StepAgent {
  runtime?: Runtime;
  model?: string;
  /** OpenCode model variant (not the variant of the pipeline). */
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  runtimeChain?: string;
}

/** What a variant changes in a step or in the split. */
export interface StepOverride {
  specialist?: string;
  agent?: StepAgent;
  /** `null` removes the additional prompt; absent keeps it. */
  additionalPrompt?: string | null;
}

export interface PipelineVariant {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  skip: string[];
  split: StepOverride | null;
  steps: Record<string, StepOverride>;
}

export interface OnReject {
  goto: string;
  maxRounds: number;
}

export interface Step {
  id: string;
  specialist: string;
  onReject: OnReject | null;
  /** Text appended to the prompt of the specialist in this step only. */
  additionalPrompt: string | null;
  /** After `done` the group stops for a review by a person before the next step. */
  humanReview: boolean;
  /** Executor override of a variant, set in the snapshot of a run only. */
  agent?: StepAgent;
}

export interface Split {
  specialist: string;
  maxGroups: number;
  /** Text appended to the prompt of the split specialist. */
  additionalPrompt: string | null;
  /** Pipeline whose steps the groups follow after the split; null: the pipeline itself. */
  pipeline: string | null;
  /** Executor override of a variant, set in the snapshot of a run only. */
  agent?: StepAgent;
}

export interface Pipeline {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  split: Split | null;
  steps: Step[];
  /** Actions of this pipeline by point; a point replaces the one of `swarm.stages` entirely. */
  stages?: StagePoints;
  /** Named overrides of steps, split and skips; absent in older snapshots. */
  variants?: PipelineVariant[];
}
