import type { RunStatsPort } from '../../ports/stats/index.ts';
import type { ProbeSummary } from '../../types/probe/harness-comparison.ts';
import type { ProbeCheckResult } from '../../types/probe/experiment.ts';
import { allGroups, isRunFinished, runPipeline, type RunState } from '../../types/run.ts';

/** Adapts one probe and the journal for that run without treating a check as delivery. */
export function harnessProbe(
  state: RunState,
  check: ProbeCheckResult | null,
  error: string | null,
  stats: ReturnType<RunStatsPort['read']>,
): ProbeSummary {
  const finished = isRunFinished(state);
  const groups = allGroups(state);
  const attempts = groups.flatMap((group) =>
    group.attempts
      .filter((attempt) => attempt.status !== 'running')
      .map((attempt) => ({ group, attempt })),
  );
  const reviewSteps = new Set(
    runPipeline(state.run)
      .steps.filter((step) => step.onReject !== null)
      .map((step) => step.id),
  );
  const records = stats.attempts.filter(
    (record) =>
      record.runId === state.run.id &&
      attempts.some(
        ({ group, attempt }) => record.group === group.slug && record.seq === attempt.seq,
      ),
  );
  const complete =
    attempts.length > 0 &&
    attempts.every(({ group, attempt }) =>
      records.some((record) => record.group === group.slug && record.seq === attempt.seq),
    );
  const sum = (field: 'durationMs' | 'inputTokens' | 'outputTokens') =>
    complete ? records.reduce((total, record) => total + record[field], 0) : null;
  // Journal token zeros are also placeholders for absent usage, not measurements.
  const tokensKnown = attempts.every(
    ({ attempt }) =>
      attempt.usage != null &&
      typeof attempt.usage.inputTokens === 'number' &&
      typeof attempt.usage.outputTokens === 'number',
  );
  return {
    runId: state.run.id,
    task: state.split?.task ?? state.groups[0]?.task ?? null,
    baseCommit: state.run.baseCommit,
    actualDelivery: 'not_attempted',
    allGroupsMerged: finished
      ? state.groups.length > 0 && state.groups.every((group) => group.status === 'merged')
      : null,
    check: {
      applied: finished && error === null ? (check?.applied ?? null) : null,
      conflicts: finished && error === null ? (check?.conflicts.length ?? null) : null,
      error,
    },
    denials: finished
      ? attempts.reduce((total, { attempt }) => total + (attempt.denials?.length ?? 0), 0)
      : null,
    outsideChanges: finished
      ? attempts.reduce((total, { attempt }) => total + (attempt.outsideChanges?.length ?? 0), 0)
      : null,
    reviewerGroups: state.groups.map((group) => group.slug),
    reviewerAttempts: state.groups
      .flatMap((group) => group.attempts.map((attempt) => ({ group, attempt })))
      .filter(({ attempt }) => reviewSteps.has(attempt.stepId))
      .map(({ group, attempt }) => ({
        group: group.slug,
        round: attempt.round,
        seq: attempt.seq,
        status: attempt.status,
        verdict: attempt.report?.verdict ?? null,
      })),
    cost: null,
    wallMs: stats.wallMs,
    attemptDurationMs: sum('durationMs'),
    inputTokens: tokensKnown ? sum('inputTokens') : null,
    outputTokens: tokensKnown ? sum('outputTokens') : null,
  };
}
