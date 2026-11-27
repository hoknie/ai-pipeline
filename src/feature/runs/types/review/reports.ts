import { blocksReview } from '../../../agents/types/index.ts';
import type { Attempt, Report } from '../attempt.ts';
import type { Group } from '../group.ts';
import { reviewHistory } from './history.ts';

/** Semantic checks use earlier saved reports, never an agent's claim that a finding disappeared. */
export function validateCycleReport(group: Group, attempt: Attempt, report: Report): string | null {
  const assignment = attempt.input.review;
  if (!assignment) return null;
  if (report.verdict === 'needs_human')
    return report.review || report.implementation || report.strategy
      ? 'needs_human uses feedback/questions; it cannot replace a completed structured handoff'
      : null;
  if (assignment.role === 'review') {
    if (!report.review || report.implementation || report.strategy)
      return 'managed reviewer must supply review';
    return validateFindings(group, attempt, report);
  }
  if (report.verdict !== 'done')
    return 'continue your own work; use needs_human for a concrete external blocker';
  if (assignment.role === 'recovery') {
    return report.strategy && !report.review && !report.implementation
      ? null
      : 'recovery must supply strategy with testable slices';
  }
  const implementation = report.implementation;
  if (!implementation || report.review || report.strategy)
    return 'managed implementer must supply implementation';
  const blocking = assignment.findings.filter(blocksReview);
  if (blocking.length > 0 && implementation.files.length === 0)
    return 'no changed files: continue implementation or describe a concrete blocker';
  for (const finding of blocking) {
    if (!implementation.resolutions.some((item) => item.id === finding.id))
      return `missing resolution and tests for ${finding.id}`;
  }
  if (
    implementation.resolutions.some(
      (item) => !assignment.findings.some((finding) => finding.id === item.id),
    )
  )
    return 'resolution refers to an unknown finding';
  for (const command of assignment.requiredChecks) {
    if (!implementation.checks.some((item) => item.command === command && item.result === 'passed'))
      return `required check has not passed: ${command}`;
  }
  if (implementation.checks.some((check) => check.result === 'failed'))
    return 'fix failed checks before reporting done';
  return null;
}

function validateFindings(group: Group, attempt: Attempt, report: Report): string | null {
  const current = report.review;
  if (!current) return 'missing review';
  const history = reviewHistory(group, attempt.stepId, attempt.seq);
  const previous = history.at(-1)?.report?.review?.findings ?? [];
  for (const finding of previous) {
    const next = current.findings.find((item) => item.id === finding.id);
    if (!next && !current.resolved.some((item) => item.id === finding.id))
      return `finding ${finding.id} needs an explicit verified closure`;
    if (next && blocksReview(finding) && !blocksReview(next))
      return `finding ${finding.id} must be resolved, not downgraded`;
  }
  for (const closure of current.resolved) {
    if (!previous.some((item) => item.id === closure.id))
      return `cannot close unknown or already closed finding ${closure.id}`;
  }
  for (const finding of current.findings) {
    if (previous.some((item) => item.id === finding.id)) continue;
    const seen = history.some((item) =>
      item.report?.review?.findings.some((old) => old.id === finding.id),
    );
    if (seen && finding.origin !== 'regression')
      return `reopened finding ${finding.id} must be a regression`;
    if (history.length > 0 && finding.origin === 'initial')
      return `new finding ${finding.id} must explain missed or regression origin`;
  }
  const blocked = current.findings.some(blocksReview);
  if ((report.verdict === 'rejected') !== blocked)
    return blocked
      ? 'blocking findings require rejected'
      : 'only blocker or major findings may reject work';
  return null;
}
