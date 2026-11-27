import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../src/shared/i18n/index.ts';
import { draftOf, valueOf } from '../src/features/pipelines/form/steps/draft.ts';
import { patchStep } from '../src/features/pipelines/form/steps/draftOps.ts';
import { ReviewResult } from '../src/features/runs/group/ReviewResult.tsx';
import type { AttemptView } from '../src/shared/api/types.ts';

describe('review protocol in pipeline and attempt views', () => {
  it.each([
    null,
    42,
    '',
    { stagnant_rounds: 2, recovery_step: 'plan', required_checks: ['npm run check'] },
  ])('preserves the exact policy on unrelated edits: %j', (policy) => {
    const draft = draftOf({
      steps: [
        { id: 'plan', specialist: 'plan' },
        { id: 'code', specialist: 'coder' },
        {
          id: 'review',
          specialist: 'reviewer',
          on_reject: { goto: 'code', max_rounds: 5, review: policy },
        },
      ],
    });
    const output = valueOf({ ...draft, name: 'Renamed' });
    expect((output.steps as Record<string, unknown>[])[2]?.on_reject).toEqual({
      goto: 'code',
      max_rounds: 5,
      review: policy,
    });
  });

  it('keeps the recovery reference attached when its step is renamed', () => {
    const draft = draftOf({
      steps: [
        { id: 'plan', specialist: 'plan' },
        { id: 'code', specialist: 'coder' },
        {
          id: 'review',
          specialist: 'reviewer',
          on_reject: { goto: 'code', max_rounds: 5, review: { recovery_step: 'plan' } },
        },
      ],
    });
    const renamed = patchStep(draft, draft.steps[0]!.key, { autoId: false, fixedId: 'replan' });
    expect((valueOf(renamed).steps as Record<string, unknown>[])[2]?.on_reject).toMatchObject({
      review: { recovery_step: 'replan' },
    });
  });

  it('shows stable IDs, provenance, closures, fix evidence and the revised acceptance plan', () => {
    const attempt = {
      review: {
        findings: [
          {
            id: 'R1',
            severity: 'major',
            file: 'form.ts:10',
            scenario: 'Rename with null',
            expected: 'Preserve raw value',
            evidence: 'Payload loses key',
            origin: 'missed',
            reason: 'Another field had the same bug',
          },
        ],
        resolved: [{ id: 'R0', evidence: 'Regression verified' }],
      },
      implementation: {
        files: ['form.ts'],
        resolutions: [{ id: 'R1', change: 'Keep raw value', tests: 'Payload matrix passed' }],
        checks: [{ command: 'npm run check', result: 'passed', evidence: 'Final gate passed' }],
      },
      strategy: {
        summary: 'Use raw source',
        slices: [{ title: 'Preservation', acceptance: 'Null survives rename' }],
      },
    } as AttemptView;
    render(<ReviewResult attempt={attempt} />);
    expect(screen.getByText(/R1.*form.ts:10/)).toBeTruthy();
    expect(screen.getByText(/R0.*Regression verified/)).toBeTruthy();
    expect(screen.getByText(/Payload matrix passed/)).toBeTruthy();
    expect(screen.getByText(/Null survives rename/)).toBeTruthy();
  });
});
// @vitest-environment jsdom
