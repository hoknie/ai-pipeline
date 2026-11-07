import { type SpecialistLevel } from './specialist.ts';

/** Points of the pipeline where actions run, in the order of the pipeline. */
export const ACTION_POINTS = [
  'before_split',
  'after_split',
  'before_delivery',
  'after_delivery',
] as const;

export type ActionPoint = (typeof ACTION_POINTS)[number];

export const ACTION_FAILURES = ['stop', 'continue'] as const;

export type ActionFailure = (typeof ACTION_FAILURES)[number];

export const DEFAULT_ACTION_TIMEOUT_SECONDS = 600;

/** A pipeline action: a shell command (`run`) or a step of a specialist (`specialist`). */
export interface Action {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  run: string | null;
  specialist: string | null;
  /** Text appended to the prompt of the specialist; only with `specialist`. */
  additionalPrompt: string | null;
  /** Seconds a command may run; only with `run`. */
  timeoutSeconds: number;
  onFailure: ActionFailure;
  /** Level of the definition. */
  level: SpecialistLevel;
}

/** Ids of actions by pipeline point; a point that is absent has no value of its own. */
export type StagePoints = Partial<Record<ActionPoint, string[]>>;
