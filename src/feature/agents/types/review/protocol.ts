export const REVIEW_ITEMS_LIMIT = 50;
export const REVIEW_TEXT_LIMIT = 2000;
export const REVIEW_ID_LIMIT = 80;
export const REVIEW_SEVERITIES = ['blocker', 'major', 'minor'] as const;
export const REVIEW_ORIGINS = ['initial', 'missed', 'regression'] as const;

export interface ReviewFinding {
  id: string;
  severity: (typeof REVIEW_SEVERITIES)[number];
  file: string;
  scenario: string;
  expected: string;
  evidence: string;
  origin: (typeof REVIEW_ORIGINS)[number];
  reason: string;
}

export interface ReviewClosure {
  id: string;
  evidence: string;
}

export interface ReviewReport {
  findings: ReviewFinding[];
  resolved: ReviewClosure[];
}

export interface ImplementationReport {
  files: string[];
  resolutions: { id: string; change: string; tests: string }[];
  checks: { command: string; result: 'passed' | 'failed'; evidence: string }[];
}

export interface StrategyReport {
  summary: string;
  slices: { title: string; acceptance: string }[];
}

/** A compact handoff; the full reports remain in the attempt history. */
export interface ReviewAssignment {
  role: 'review' | 'implementation' | 'recovery';
  reviewerStep: string;
  findings: ReviewFinding[];
  requiredChecks: string[];
  implementation?: ImplementationReport;
  strategy?: StrategyReport;
}

export const blocksReview = (finding: ReviewFinding): boolean => finding.severity !== 'minor';
