import { type StagePoints } from './action.ts';

export const MAX_GROUPS_RANGE = [1, 20] as const;

export const DEFAULT_MAX_GROUPS = 5;

export const MAX_ROUNDS_RANGE = [1, 10] as const;

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
}

export interface Split {
  specialist: string;
  maxGroups: number;
  /** Text appended to the prompt of the split specialist. */
  additionalPrompt: string | null;
  /** Pipeline whose steps the groups follow after the split; null: the pipeline itself. */
  pipeline: string | null;
}

export interface Pipeline {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  split: Split | null;
  steps: Step[];
  /** Actions of this pipeline by point; a point replaces the one of `swarm.stages` entirely. */
  stages?: StagePoints;
}
