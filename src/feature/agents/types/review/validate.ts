import {
  REVIEW_ID_LIMIT,
  REVIEW_ITEMS_LIMIT,
  REVIEW_ORIGINS,
  REVIEW_SEVERITIES,
  REVIEW_TEXT_LIMIT,
  type ImplementationReport,
  type ReviewReport,
  type StrategyReport,
} from './protocol.ts';

const text = (value: unknown, limit = REVIEW_TEXT_LIMIT): boolean =>
  typeof value === 'string' && value.trim().length > 0 && [...value].length <= limit;
const list = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length <= REVIEW_ITEMS_LIMIT;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function rows(value: unknown, fields: string[], ids = false): boolean {
  if (!list(value)) return false;
  const seen = new Set<string>();
  return value.every((item) => {
    if (
      !object(item) ||
      fields.some(
        (field) => !text(item[field], field === 'id' ? REVIEW_ID_LIMIT : REVIEW_TEXT_LIMIT),
      )
    )
      return false;
    if (ids) {
      if (typeof item.id !== 'string' || seen.has(item.id)) return false;
      seen.add(item.id);
    }
    return true;
  });
}

export function validateReviewData(report: {
  review?: ReviewReport;
  implementation?: ImplementationReport;
  strategy?: StrategyReport;
}): string | null {
  const { review, implementation, strategy } = report;
  if (review !== undefined) {
    if (
      !object(review) ||
      !rows(review.findings, ['id', 'file', 'scenario', 'expected', 'evidence', 'reason'], true) ||
      !rows(review.resolved, ['id', 'evidence'], true)
    )
      return 'review needs bounded findings/resolved with unique IDs and non-empty evidence';
    for (const finding of review.findings) {
      if (!REVIEW_SEVERITIES.includes(finding.severity) || !REVIEW_ORIGINS.includes(finding.origin))
        return 'invalid finding severity or origin';
      if (review.resolved.some((item) => item.id === finding.id))
        return `finding ${finding.id} is both open and resolved`;
    }
  }
  if (implementation !== undefined) {
    if (
      !object(implementation) ||
      !list(implementation.files) ||
      implementation.files.some((file) => !text(file)) ||
      !rows(implementation.resolutions, ['id', 'change', 'tests'], true) ||
      !rows(implementation.checks, ['command', 'evidence'])
    )
      return 'implementation needs bounded files, resolutions and checks with non-empty evidence';
    if (implementation.checks.some((check) => !['passed', 'failed'].includes(check.result)))
      return 'invalid check result';
    if (
      new Set(implementation.checks.map((check) => check.command)).size !==
      implementation.checks.length
    )
      return 'duplicate check command';
  }
  if (
    strategy !== undefined &&
    (!object(strategy) ||
      !text(strategy.summary) ||
      !rows(strategy.slices, ['title', 'acceptance']) ||
      strategy.slices.length === 0)
  )
    return 'strategy needs a summary and 1 to 50 slices with acceptance criteria';
  if ([review, implementation, strategy].filter((value) => value !== undefined).length > 1)
    return 'review, implementation and strategy are mutually exclusive';
  return null;
}
