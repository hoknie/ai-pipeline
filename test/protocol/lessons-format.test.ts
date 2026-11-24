import { describe, expect, it } from 'vitest';

import { formatLessons, plainStyle } from '../../src/presentation/format/index.ts';
import type { LessonSummaryView } from '../../src/presentation/ipc/contract/index.ts';

const VIEW: LessonSummaryView = {
  runId: '0abc',
  repository: '/repo',
  specialists: [
    {
      specialist: 'coder',
      attempts: 3,
      verdicts: { done: 2, rejected: 1, needs_human: 0, failed: 0 },
      denials: 2,
      outsideChanges: 0,
      deliveryFailures: 1,
      lessons: [
        {
          id: 'delivery:apply_failed',
          kind: 'delivery',
          text: 'Applying the result of the group failed twice (tasks #7, #8; last seen 2026-01-02).',
          evidence: { occurrences: 2, tasks: [7, 8], seenAt: Date.UTC(2026, 0, 2) },
          priority: 24,
        },
      ],
      block: '# Lessons from earlier runs',
      dropped: 1,
    },
    {
      specialist: 'reviewer',
      attempts: 1,
      verdicts: { done: 1, rejected: 0, needs_human: 0, failed: 0 },
      denials: 0,
      outsideChanges: 0,
      deliveryFailures: 0,
      lessons: [],
      block: '',
      dropped: 0,
    },
  ],
};

describe('formatLessons', () => {
  it('shows every specialist with its lessons and evidence', () => {
    const text = formatLessons(VIEW, plainStyle);
    expect(text).toContain('Lessons of run 0abc (/repo)');
    expect(text).toContain('coder: 3 attempt(s) (done 2, rejected 1)');
    expect(text).toContain('1 lesson(s), 1 dropped by the limit');
    expect(text).toContain('Applying the result of the group failed twice');
    expect(text).toContain('[2 times (#7, #8; last seen 2026-01-02)]');
    expect(text).toContain('reviewer: 1 attempt(s) (done 1) · no lessons yet');
  });

  it('names a run without specialists', () => {
    expect(formatLessons({ ...VIEW, specialists: [] }, plainStyle)).toBe(
      'Lessons of run 0abc (/repo)\nNo specialists took part in this run.',
    );
  });
});
