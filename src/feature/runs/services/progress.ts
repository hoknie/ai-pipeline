import {
  type Group,
  type RunState,
  type StepProgress,
  attemptVerdict,
  stepLabel,
  stepsOf,
} from '../types/index.ts';

const ALL_STEPS = new Set(['merged', 'merging', 'conflict']);

/** Passes of steps: attempts that ended with a verdict `done` or `rejected`. */
function passes(group: Group): number {
  return group.attempts.filter((attempt) => {
    const verdict = attemptVerdict(attempt);
    return verdict === 'done' || verdict === 'rejected';
  }).length;
}

function position(group: Group, count: number): number {
  const running = group.attempts.find((attempt) => attempt.status === 'running');
  const index =
    running?.stepIndex ?? group.pending?.stepIndex ?? group.attempts.at(-1)?.stepIndex ?? 0;
  return Math.max(0, Math.min(index, count));
}

/** Step progress of a run: every pass of a step is a stage, the path ahead runs from the current step. */
export function stepProgress(state: RunState): StepProgress {
  let done = 0;
  let total = 0;
  let current: StepProgress['current'] = null;
  try {
    for (const group of state.groups) {
      const steps = stepsOf(state.run, group);
      const made = passes(group);
      if (ALL_STEPS.has(group.status)) {
        const all = Math.max(made, steps.length);
        done += all;
        total += all;
        continue;
      }
      const at = position(group, steps.length);
      done += made;
      total += made + steps.length - at;
      const step = steps[at];
      if (state.groups.length === 1 && step) {
        current = {
          step: step.id,
          name: stepLabel(state.run.config, steps, step),
          number: made + 1,
        };
      }
    }
  } catch {
    return { done: 0, total: 0, current: null };
  }
  return { done, total, current };
}
