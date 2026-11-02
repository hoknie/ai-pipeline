import { findSpecialist, type SpecialistLevel } from '../config/index.ts';

import { allGroups, stepsOf, type RunState } from './model.ts';

export interface SpecialistRunning {
  slug: string;
  title: string;
  step: string;
  startedAt: number;
}

export interface SpecialistWaiting {
  slug: string;
  title: string;
  step: string;
}

/** What one run does with one specialist now: attempts it runs and groups waiting for it. */
export interface SpecialistUse {
  specialist: string;
  level: SpecialistLevel;
  /** Limit of simultaneously running attempts of the specialist; null means no limit. */
  max: number | null;
  running: SpecialistRunning[];
  waiting: SpecialistWaiting[];
}

/** Specialists that run or are waited for in the run, sorted by slug. Empty for a finished run. */
export function specialistUse(state: RunState): SpecialistUse[] {
  if (state.run.finishedAt !== null) return [];
  const uses = new Map<string, SpecialistUse>();
  const entry = (slug: string): SpecialistUse => {
    let use = uses.get(slug);
    if (!use) {
      const found = findSpecialist(state.run.config, slug);
      use = {
        specialist: slug,
        level: found?.level ?? 'project',
        max: found?.max ?? null,
        running: [],
        waiting: [],
      };
      uses.set(slug, use);
    }
    return use;
  };
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      if (attempt.status !== 'running') continue;
      entry(attempt.specialist).running.push({
        slug: group.slug,
        title: group.title,
        step: attempt.stepId,
        startedAt: attempt.startedAt,
      });
    }
    if (group.status === 'queued' && group.pending !== null) {
      let step;
      try {
        step = stepsOf(state.run, group)[group.pending.stepIndex];
      } catch {
        step = undefined;
      }
      if (step) {
        entry(step.specialist).waiting.push({
          slug: group.slug,
          title: group.title,
          step: step.id,
        });
      }
    }
  }
  return [...uses.values()].sort((left, right) =>
    left.specialist < right.specialist ? -1 : left.specialist > right.specialist ? 1 : 0,
  );
}
