import type { Verdict } from '../../../agents/types/index.ts';
import type { AttemptStatus } from '../constants.ts';
import { attemptHistoryResult, type AttemptHistoryResult } from '../history/attempt-history.ts';

/** Values describe one actual probe run, not the source run or an aggregate. */
export interface ProbeSummary {
  runId: string;
  task: string | null;
  baseCommit: string | null;
  actualDelivery: 'not_attempted';
  allGroupsMerged: boolean | null;
  check: { applied: boolean | null; conflicts: number | null; error: string | null };
  outsideChanges: number | null;
  denials: number | null;
  reviewerGroups?: string[];
  reviewerAttempts: {
    group: string;
    round: number;
    seq: number;
    status: AttemptStatus;
    verdict: Verdict | null;
  }[];
  cost: number | null;
  wallMs: number | null;
  attemptDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface HarnessComparison {
  baseline: ProbeSummary;
  candidate: ProbeSummary;
  recommendation: 'baseline' | 'candidate' | 'unknown' | 'stop';
  reason: string;
  secondaryReason: string;
  reviewers: { baseline: AttemptHistoryResult[]; candidate: AttemptHistoryResult[] };
  reviewGroups: { baseline: GroupReview[]; candidate: GroupReview[] };
  reviewOutcome: { baseline: AttemptHistoryResult; candidate: AttemptHistoryResult };
  rounds: { baseline: number | null; candidate: number | null };
  /** Ordered secondary observations; these never break a check tie. */
  secondary: {
    signal: 'conflicts' | 'denials' | 'outsideChanges';
    baseline: number | null;
    candidate: number | null;
  }[];
}

interface GroupReview {
  group: string;
  outcome: AttemptHistoryResult;
  rounds: number | null;
}

function groupReviews(p: ProbeSummary): GroupReview[] {
  return [...(p.reviewerGroups ?? [])].sort().map((group) => {
    const attempts = p.reviewerAttempts
      .filter((attempt) => attempt.group === group)
      .sort((a, b) => a.seq - b.seq);
    const last = attempts.at(-1);
    const outcome = last ? attemptHistoryResult(last.status, last.verdict) : 'unknown';
    const done = attempts.findIndex((a) => attemptHistoryResult(a.status, a.verdict) === 'done');
    return {
      group,
      outcome: outcome === 'running' ? 'unknown' : outcome,
      rounds: done < 0 ? null : new Set(attempts.slice(0, done + 1).map((a) => a.round)).size,
    };
  });
}

function reviewOutcome(groups: GroupReview[]): AttemptHistoryResult {
  if (groups.length === 0) return 'unknown';
  for (const outcome of ['failed', 'rejected', 'cancelled', 'needs_human', 'unknown'] as const) {
    if (groups.some((group) => group.outcome === outcome)) return outcome;
  }
  return 'done';
}

function rounds(groups: GroupReview[]): number | null {
  return reviewOutcome(groups) === 'done' && groups.every((group) => group.rounds !== null)
    ? Math.max(...groups.map((group) => group.rounds as number))
    : null;
}

function secondaryReasonOf(baseline: ProbeSummary, candidate: ProbeSummary): string {
  const reviewRank = (p: ProbeSummary): number | null => {
    const result = reviewOutcome(groupReviews(p));
    if (result === 'unknown' || result === 'running') return null;
    return result === 'done' ? 1 : 0;
  };
  const tokens = (p: ProbeSummary): number | null =>
    p.inputTokens === null || p.outputTokens === null ? null : p.inputTokens + p.outputTokens;
  const time =
    baseline.wallMs !== null && candidate.wallMs !== null
      ? [baseline.wallMs, candidate.wallMs]
      : [baseline.attemptDurationMs, candidate.attemptDurationMs];
  const secondarySignals: [string, number | null, number | null, boolean][] = [
    ['conflicts', baseline.check.conflicts, candidate.check.conflicts, false],
    ['outside changes', baseline.outsideChanges, candidate.outsideChanges, false],
    ['denials', baseline.denials, candidate.denials, false],
    ['review outcome', reviewRank(baseline), reviewRank(candidate), true],
    ['review rounds', rounds(groupReviews(baseline)), rounds(groupReviews(candidate)), false],
    ['measured cost', baseline.cost, candidate.cost, false],
    ['time', time[0] ?? null, time[1] ?? null, false],
    ['tokens', tokens(baseline), tokens(candidate), false],
  ];
  const first = secondarySignals.find(([, a, b]) => a !== null && b !== null && a !== b);
  return first === undefined
    ? 'No differing comparable secondary signal.'
    : `First differing secondary signal: ${first[0]} favors ${(first[2] as number) > (first[1] as number) === first[3] ? 'candidate' : 'baseline'}.`;
}

/** Only observed quality and safety decide; cost is descriptive, never a tie-breaker. */
export function compareHarnessProbes(
  baseline: ProbeSummary,
  candidate: ProbeSummary,
): HarnessComparison {
  let recommendation: HarnessComparison['recommendation'] = 'unknown';
  let reason = 'The probes lack comparable task, base, check, or safety data.';
  const complete = (p: ProbeSummary) =>
    p.check.error === null &&
    p.check.applied !== null &&
    p.check.conflicts !== null &&
    p.allGroupsMerged !== null &&
    p.outsideChanges !== null;
  if (candidate.outsideChanges !== null && candidate.outsideChanges > 0) {
    recommendation = 'stop';
    reason = 'The candidate changed files outside its worktree; stop and investigate.';
  } else if (
    baseline.runId !== candidate.runId &&
    !!baseline.task &&
    baseline.task === candidate.task &&
    !!baseline.baseCommit &&
    baseline.baseCommit === candidate.baseCommit &&
    complete(baseline) &&
    complete(candidate)
  ) {
    if (baseline.check.applied === candidate.check.applied) {
      recommendation = 'baseline';
      reason = 'The checks tie; keep the baseline regardless of secondary signals or cost.';
    } else if (candidate.check.applied && candidate.allGroupsMerged) {
      recommendation = 'candidate';
      reason = 'The candidate passed the hypothetical delivery check with all groups merged.';
    } else {
      recommendation = 'baseline';
      reason = 'The candidate lacks a complete, strictly better hypothetical delivery check.';
    }
  }
  const baselineReviews = groupReviews(baseline);
  const candidateReviews = groupReviews(candidate);
  return {
    baseline,
    candidate,
    recommendation,
    reason,
    secondaryReason: secondaryReasonOf(baseline, candidate),
    reviewers: {
      baseline: baselineReviews.map((group) => group.outcome),
      candidate: candidateReviews.map((group) => group.outcome),
    },
    reviewGroups: { baseline: baselineReviews, candidate: candidateReviews },
    reviewOutcome: {
      baseline: reviewOutcome(baselineReviews),
      candidate: reviewOutcome(candidateReviews),
    },
    rounds: {
      baseline: rounds(baselineReviews),
      candidate: rounds(candidateReviews),
    },
    secondary: [
      {
        signal: 'conflicts',
        baseline: baseline.check.error === null ? baseline.check.conflicts : null,
        candidate: candidate.check.error === null ? candidate.check.conflicts : null,
      },
      {
        signal: 'outsideChanges',
        baseline: baseline.outsideChanges,
        candidate: candidate.outsideChanges,
      },
      { signal: 'denials', baseline: baseline.denials, candidate: candidate.denials },
    ],
  };
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

/** Human-readable report; the check is not an instruction to apply the result. */
export function formatHarnessProposal(comparison: HarnessComparison): string {
  const number = (value: number | null) =>
    value === null ? 'unknown' : value.toLocaleString('en-US');
  const { baseline: b, candidate: c } = comparison;
  const check = (p: ProbeSummary) =>
    p.check.error !== null || p.check.applied === null
      ? 'unknown'
      : p.check.applied
        ? 'passed'
        : 'failed';
  const row = (label: string, left: string, right: string) => `| ${label} | ${left} | ${right} |`;
  return [
    '# Harness probe comparison',
    '',
    'The check is hypothetical; actualDelivery: not_attempted. Nothing is automatically applied.',
    'Signal priority: check, conflicts, outside changes, denials, review, cost, time, tokens. A check tie keeps the baseline.',
    '',
    `| Metric | Baseline (${escapeMarkdown(b.runId)}) | Candidate (${escapeMarkdown(c.runId)}) |`,
    '| --- | ---: | ---: |',
    row('Hypothetical check', check(b), check(c)),
    row(
      'All groups merged',
      String(b.allGroupsMerged ?? 'unknown'),
      String(c.allGroupsMerged ?? 'unknown'),
    ),
    row(
      'Check error',
      escapeMarkdown(b.check.error ?? 'none'),
      escapeMarkdown(c.check.error ?? 'none'),
    ),
    ...comparison.secondary.map((s) => row(s.signal, number(s.baseline), number(s.candidate))),
    row(
      'Reviewer rounds to done',
      number(comparison.rounds.baseline),
      number(comparison.rounds.candidate),
    ),
    row('Reviewer results', comparison.reviewOutcome.baseline, comparison.reviewOutcome.candidate),
    ...[
      ...new Set(
        [...comparison.reviewGroups.baseline, ...comparison.reviewGroups.candidate].map(
          (g) => g.group,
        ),
      ),
    ]
      .sort()
      .map((group) => {
        const value = (groups: GroupReview[]) => {
          const review = groups.find((item) => item.group === group);
          return review ? `${review.outcome}; rounds: ${number(review.rounds)}` : 'unknown';
        };
        return row(
          `Review ${escapeMarkdown(group)}`,
          value(comparison.reviewGroups.baseline),
          value(comparison.reviewGroups.candidate),
        );
      }),
    row('Cost', number(b.cost), number(c.cost)),
    row('Wall time (ms)', number(b.wallMs), number(c.wallMs)),
    row('Attempt duration (ms)', number(b.attemptDurationMs), number(c.attemptDurationMs)),
    row('Input tokens', number(b.inputTokens), number(c.inputTokens)),
    row('Output tokens', number(b.outputTokens), number(c.outputTokens)),
    '',
    `Pair signal: **${comparison.recommendation}**. ${escapeMarkdown(comparison.reason)} This is not a recommendation to apply a change.`,
    escapeMarkdown(comparison.secondaryReason),
  ].join('\n');
}
