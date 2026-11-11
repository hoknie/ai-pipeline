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
  /** The script of a command (may span lines); null: not a command. */
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

/**
 * One script for a list of scripts stored by older builds: each of several runs in its own
 * subshell, one after another, and the first failure stops the rest with its code.
 */
export function legacyScript(scripts: readonly string[]): string {
  if (scripts.length === 1) return scripts[0]!;
  return scripts.map((script) => `(\n${script}\n)`).join(' &&\n');
}

/** Ids of actions by pipeline point; a point that is absent has no value of its own. */
export type StagePoints = Partial<Record<ActionPoint, string[]>>;
