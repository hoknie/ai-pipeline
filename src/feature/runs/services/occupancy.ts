import { type Step, findSpecialist } from '../../swarm-config/types/index.ts';
import {
  type RunState,
  type SpecialistUse,
  allGroups,
  attemptStepLabel,
  isRepairGroup,
  specialistName,
  stepLabel,
  stepsOf,
} from '../types/index.ts';

/** Specialists that run or are waited for in the run, sorted by slug. Empty for a finished run. */
export function specialistUse(state: RunState): SpecialistUse[] {
  if (state.run.finishedAt !== null) return [];
  const uses = new Map<string, SpecialistUse>();
  const entry = (slug: string, repair: boolean): SpecialistUse => {
    let use = uses.get(slug);
    if (!use) {
      // The repair group shows the profile the observer had when the repair started.
      const found = repair
        ? (state.run.repair.specialist ?? undefined)
        : findSpecialist(state.run.config, slug);
      use = {
        specialist: slug,
        name: found?.name.trim() ? found.name : specialistName(state.run.config, slug),
        level: found?.level ?? 'project',
        max: repair ? null : (found?.max ?? null),
        running: [],
        waiting: [],
      };
      uses.set(slug, use);
    }
    return use;
  };
  for (const group of allGroups(state)) {
    const repair = isRepairGroup(group);
    for (const attempt of group.attempts) {
      if (attempt.status !== 'running') continue;
      entry(attempt.specialist, repair).running.push({
        slug: group.slug,
        title: group.title,
        step: attempt.stepId,
        stepName: attemptStepLabel(state, group, attempt),
        startedAt: attempt.startedAt,
      });
    }
    if (group.status === 'queued' && group.pending !== null) {
      let step;
      let steps: Step[] = [];
      try {
        steps = stepsOf(state.run, group);
        step = steps[group.pending.stepIndex];
      } catch {
        step = undefined;
      }
      if (step) {
        entry(step.specialist, repair).waiting.push({
          slug: group.slug,
          title: group.title,
          step: step.id,
          stepName: stepLabel(state.run.config, steps, step),
        });
      }
    }
  }
  return [...uses.values()].sort((left, right) =>
    left.specialist < right.specialist ? -1 : left.specialist > right.specialist ? 1 : 0,
  );
}
