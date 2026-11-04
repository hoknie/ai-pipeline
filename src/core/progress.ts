import { stepLabel } from './topology.ts';
import { stepsOf, type Group, type RunState } from './model.ts';

export interface StepProgress {
  /** Steps reached by all work groups; a return to an earlier step does not lower it. */
  done: number;
  /** Steps of all work groups; 0 while the task is split. */
  total: number;
  /** Step of the only group, counted from one; null with several groups or when all steps are passed. */
  current: { step: string; name: string; number: number } | null;
}

const ALL_STEPS = new Set(['merged', 'merging', 'conflict']);

function position(group: Group, count: number): number {
  if (ALL_STEPS.has(group.status)) return count;
  if (group.status === 'queued') return Math.min(group.pending?.stepIndex ?? 0, count);
  return Math.min(group.attempts.at(-1)?.stepIndex ?? 0, count);
}

function reached(group: Group, count: number): number {
  if (ALL_STEPS.has(group.status)) return count;
  const furthest = Math.max(0, ...group.attempts.map((attempt) => attempt.stepIndex));
  return Math.min(count, Math.max(position(group, count), furthest));
}

/** Step progress of a run: reached steps by the furthest step, the current step by position. */
export function stepProgress(state: RunState): StepProgress {
  let done = 0;
  let total = 0;
  let current: StepProgress['current'] = null;
  try {
    for (const group of state.groups) {
      const steps = stepsOf(state.run, group);
      const passed = position(group, steps.length);
      done += reached(group, steps.length);
      total += steps.length;
      const step = steps[passed];
      if (state.groups.length === 1 && step) {
        current = {
          step: step.id,
          name: stepLabel(state.run.config, steps, step),
          number: passed + 1,
        };
      }
    }
  } catch {
    return { done: 0, total: 0, current: null };
  }
  return { done, total, current };
}
