import {
  blocksReview,
  type ReviewAssignment,
  type ReviewFinding,
} from '../../../agents/types/index.ts';
import type { Step } from '../../../swarm-config/types/index.ts';
import {
  groupPipeline,
  stepSpecialist,
  type Specialist,
} from '../../../swarm-config/types/index.ts';
import type { Attempt } from '../attempt.ts';
import { stepsOf, type Group, type Pending } from '../group.ts';
import { runPipeline, type Run } from '../run.ts';

export function escalatedSpecialist(
  run: Run,
  group: Group,
  stepId: string | undefined,
): Specialist | undefined {
  if (!stepId) return undefined;
  const reviewer = groupPipeline(run.config, runPipeline(run)).steps.find(
    (item) => item.onReject?.goto === stepId && item.onReject?.review?.escalationSpecialist,
  );
  const slug = reviewer?.onReject?.review?.escalationSpecialist;
  return slug && reviewer && recoveryUsed(group, reviewer.id)
    ? stepSpecialist(run.config, { specialist: slug })
    : undefined;
}

export function reviewHistory(group: Group, reviewerStep: string, before = Infinity): Attempt[] {
  return group.attempts.filter(
    (item) =>
      item.seq < before &&
      item.stepId === reviewerStep &&
      item.status === 'finished' &&
      item.report?.review &&
      item.report.verdict !== 'needs_human',
  );
}

export function openFindings(
  group: Group,
  reviewerStep: string,
  before = Infinity,
): ReviewFinding[] {
  return reviewHistory(group, reviewerStep, before).at(-1)?.report?.review?.findings ?? [];
}

export function recoveryUsed(group: Group, reviewerStep: string): boolean {
  return group.attempts.some(
    (item) =>
      item.input.review?.role === 'recovery' && item.input.review.reviewerStep === reviewerStep,
  );
}

export function stagnantRounds(group: Group, reviewerStep: string): number {
  let previous: ReviewFinding[] = [];
  let count = 0;
  let previousSeq = 0;
  for (const attempt of reviewHistory(group, reviewerStep)) {
    if (
      group.attempts.some(
        (item) =>
          item.seq > previousSeq &&
          item.seq < attempt.seq &&
          item.input.review?.role === 'recovery' &&
          item.input.review.reviewerStep === reviewerStep,
      )
    )
      count = 0;
    const review = attempt.report?.review;
    if (!review) continue;
    const blocking = previous.filter(blocksReview);
    const closed = blocking.some((finding) =>
      review.resolved.some((item) => item.id === finding.id),
    );
    count =
      attempt.report?.verdict === 'rejected' && blocking.length > 0 && !closed ? count + 1 : 0;
    previous = review.findings;
    previousSeq = attempt.seq;
  }
  return count;
}

export function reviewStep(run: Run, group: Group, stepId: string): Step | undefined {
  const steps = stepsOf(run, group);
  return (
    steps.find((step) => step.id === stepId && step.onReject?.review) ??
    steps.find((step) => step.onReject?.review && step.onReject.goto === stepId)
  );
}

export function reviewAssignment(
  run: Run,
  group: Group,
  pending: Pending,
): ReviewAssignment | undefined {
  const steps = stepsOf(run, group);
  const current = steps[pending.stepIndex];
  const last = group.attempts.at(-1);
  const continuing =
    last?.stepId === current?.id &&
    last?.input.review?.role === 'recovery' &&
    (last.report?.verdict !== 'done' || pending.reviewed)
      ? last.input.review.reviewerStep
      : undefined;
  const recoveryFor = pending.recoveryFor ?? continuing;
  const reviewer = recoveryFor
    ? steps.find((step) => step.id === recoveryFor)
    : current
      ? reviewStep(run, group, current.id)
      : undefined;
  const policy = reviewer?.onReject?.review;
  if (!reviewer || !policy) return undefined;
  const recent = [...group.attempts].reverse();
  const implementation = recent.find(
    (item) =>
      item.status === 'finished' &&
      item.stepId === reviewer.onReject?.goto &&
      item.report?.implementation,
  )?.report?.implementation;
  const strategy = recent.find(
    (item) =>
      item.status === 'finished' &&
      item.input.review?.reviewerStep === reviewer.id &&
      item.report?.strategy,
  )?.report?.strategy;
  return {
    role: recoveryFor ? 'recovery' : current?.id === reviewer.id ? 'review' : 'implementation',
    reviewerStep: reviewer.id,
    findings: openFindings(group, reviewer.id),
    requiredChecks: [...policy.requiredChecks],
    ...(implementation ? { implementation } : {}),
    ...(strategy ? { strategy } : {}),
  };
}

export function findingsText(findings: ReviewFinding[]): string {
  return findings
    .map(
      (item) =>
        `[${item.id}] ${item.severity}: ${item.file}\n${item.scenario}\nExpected: ${item.expected}\nEvidence: ${item.evidence}\nOrigin: ${item.origin}: ${item.reason}`,
    )
    .join('\n\n');
}
