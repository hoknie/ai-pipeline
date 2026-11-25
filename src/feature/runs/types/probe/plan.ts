import { invalid } from '../../../../platform/errors/index.ts';
import type { ProbeBudget, ProbeRunSpec } from './experiment.ts';

/** The most candidates one experiment compares: a contrast needs at least two. */
export const PROBE_CANDIDATES_MAX = 6;
/** The most repetitions of one candidate; the exact sign test needs six decided pairs to trust a win. */
export const PROBE_REPETITIONS_MAX = 20;
/** The hard limit of runs of one experiment, whatever the caller asks for. */
export const PROBE_RUNS_MAX = 100;

/** What a request of an experiment names: the input, the candidates and the budget. */
export interface ProbePlanInput {
  sourceRun: string;
  sourceGroup: string;
  repository: string;
  pipeline: string;
  task: string;
  baseCommit: string;
  candidates: string[];
  repetitions: number;
  budget: { maxRuns: number; maxTokens?: number | null | undefined };
}

/** The checked experiment: the runs it will create, candidate by candidate. */
export interface ProbePlan {
  sourceRun: string;
  sourceGroup: string;
  repository: string;
  pipeline: string;
  task: string;
  baseCommit: string;
  candidates: string[];
  repetitions: number;
  budget: ProbeBudget;
  runs: ProbeRunSpec[];
}

function candidateProblem(candidates: string[]): string | null {
  if (candidates.length < 2)
    return 'a contrast needs at least two candidates: the baseline and one more';
  if (candidates.length > PROBE_CANDIDATES_MAX) {
    return `at most ${PROBE_CANDIDATES_MAX} candidates are allowed, got ${candidates.length}`;
  }
  if (candidates.some((candidate) => candidate.trim() === ''))
    return 'a candidate has no variant id';
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) return `candidate \`${candidate}\` is listed twice`;
    seen.add(candidate);
  }
  return null;
}

function repetitionsProblem(repetitions: number): string | null {
  if (!Number.isInteger(repetitions) || repetitions < 1)
    return 'repetitions must be a positive integer';
  if (repetitions > PROBE_REPETITIONS_MAX) {
    return `repetitions must be at most ${PROBE_REPETITIONS_MAX}, got ${repetitions}`;
  }
  return null;
}

function budgetProblem(maxRuns: number, maxTokens: number | null, planned: number): string | null {
  if (!Number.isInteger(maxRuns) || maxRuns < 1) return 'maxRuns must be a positive integer';
  if (maxRuns > PROBE_RUNS_MAX) return `maxRuns must be at most ${PROBE_RUNS_MAX}, got ${maxRuns}`;
  if (planned > maxRuns) {
    return `the plan needs ${planned} runs, above the budget of ${maxRuns}: raise maxRuns or lower repetitions`;
  }
  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    return 'maxTokens must be a positive integer or null';
  }
  return null;
}

/**
 * Plans a contrast probe: one input, every candidate run on the same task and base commit, and a
 * budget the plan may not exceed. Nothing here touches a run or the user's worktree.
 */
export function planProbes(input: ProbePlanInput): ProbePlan {
  const candidates = input.candidates.map((candidate) => candidate.trim());
  const problem = candidateProblem(candidates);
  if (problem !== null) throw invalid('probe.invalid', problem);
  const repetitionsError = repetitionsProblem(input.repetitions);
  if (repetitionsError !== null) throw invalid('probe.invalid', repetitionsError);
  const planned = candidates.length * input.repetitions;
  const maxTokens = input.budget.maxTokens ?? null;
  const budgetError = budgetProblem(input.budget.maxRuns, maxTokens, planned);
  if (budgetError !== null) throw invalid('probe.invalid', budgetError);
  const runs = candidates.flatMap((candidate) =>
    Array.from({ length: input.repetitions }, (_, index) => ({
      candidate,
      repetition: index + 1,
    })),
  );
  return {
    sourceRun: input.sourceRun,
    sourceGroup: input.sourceGroup,
    repository: input.repository,
    pipeline: input.pipeline,
    task: input.task,
    baseCommit: input.baseCommit,
    candidates,
    repetitions: input.repetitions,
    budget: { maxRuns: input.budget.maxRuns, maxTokens },
    runs,
  };
}
