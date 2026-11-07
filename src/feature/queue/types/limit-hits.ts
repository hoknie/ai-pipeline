import {
  type ProblemReason,
  type RunState,
  allGroups,
  isRepairGroup,
  limitResetsAt,
  runProblems,
} from '../../runs/types/index.ts';

/**
 * Problems that stop the queue; a question to a human does not, a usage limit stops it its own
 * way, and a manual cancel does not either: the user did it on purpose.
 */
export const STOPPING_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'failed',
  'conflict',
  'apply_failed',
]);

/** Problems that `skipFailed` takes off the places: neither a cancel nor a usage limit. */
export const SKIPPED_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  'failed',
  'conflict',
  'apply_failed',
]);

/** Problems that block the tasks depending on the run. */
export const BLOCKING_REASONS: ReadonlySet<ProblemReason> = new Set<ProblemReason>([
  ...STOPPING_REASONS,
  'cancelled',
  'usage_limit',
]);

export interface LimitHit {
  key: string;
  run: string;
  group: string;
  runtime: string;
  resetsAt: number;
}

/** Attempts of a run that ran out of the usage limit, each a problem of its own. */
export function limitHits(state: RunState): LimitHit[] {
  // A limit of the observer's agent is not a limit of the run's work.
  return allGroups(state)
    .filter((group) => !isRepairGroup(group))
    .flatMap((group) =>
      group.attempts.flatMap((attempt) => {
        const resetsAt = limitResetsAt(attempt);
        return resetsAt === null
          ? []
          : [
              {
                key: `${state.run.id}/${group.slug}/usage_limit/${attempt.seq}`,
                run: state.run.id,
                group: group.slug,
                runtime: attempt.runtime,
                resetsAt,
              },
            ];
      }),
    );
}

/** Keys of every problem and usage limit of a run now. */
export function problemKeys(state: RunState): string[] {
  return [
    ...runProblems(state).map((problem) => problem.key),
    ...limitHits(state).map((hit) => hit.key),
  ];
}
