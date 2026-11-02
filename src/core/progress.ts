import { stepsOf, type Group, type RunState } from './model.ts';

export interface StepProgress {
  /** Steps passed by all work groups; a group sent back to an earlier step passes fewer. */
  done: number;
  /** Steps of all work groups; 0 while the task is split. */
  total: number;
  /** Step of the only group, counted from one; null with several groups or when all steps are passed. */
  current: { step: string; number: number } | null;
}

const ALL_STEPS = new Set(['merged', 'merging', 'conflict']);

function position(group: Group, count: number): number {
  if (ALL_STEPS.has(group.status)) return count;
  if (group.status === 'queued') return Math.min(group.pending?.stepIndex ?? 0, count);
  return Math.min(group.attempts.at(-1)?.stepIndex ?? 0, count);
}

/** Step progress of a run by the current position of every work group. */
export function stepProgress(state: RunState): StepProgress {
  let done = 0;
  let total = 0;
  let current: StepProgress['current'] = null;
  try {
    for (const group of state.groups) {
      const steps = stepsOf(state.run, group);
      const passed = position(group, steps.length);
      done += passed;
      total += steps.length;
      const step = steps[passed];
      if (state.groups.length === 1 && step) current = { step: step.id, number: passed + 1 };
    }
  } catch {
    return { done: 0, total: 0, current: null };
  }
  return { done, total, current };
}
