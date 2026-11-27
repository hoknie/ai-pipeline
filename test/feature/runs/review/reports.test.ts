import { describe, expect, it } from 'vitest';
import { validateReport } from '../../../../src/feature/runs/types/index.ts';
import { atReview, code, finding, report, review, runningAttempt, step } from './helpers.ts';

describe('managed handoff validation', () => {
  it('refuses missing IDs, invented closures, downgrades and unclassified new defects without saving', () => {
    const state = atReview();
    review(state, [finding()]);
    step(state);
    code(state);
    step(state);
    const bad = [
      { findings: [], resolved: [] },
      { findings: [finding()], resolved: [{ id: 'unknown', evidence: 'fixed' }] },
      { findings: [finding('R1', { severity: 'minor' })], resolved: [] },
      { findings: [finding(), finding('R2')], resolved: [] },
    ];
    for (const value of bad) {
      expect(() =>
        report(state, { verdict: 'rejected', summary: 'review', feedback: null, review: value }),
      ).toThrow(/invalid report/);
      expect(runningAttempt(state).report).toBeNull();
    }
    review(state, [], ['R1']);
  });

  it('requires implementation evidence, target tests and the final gate', () => {
    const state = atReview();
    review(state, [finding()]);
    step(state);
    const base = { verdict: 'done' as const, summary: 'fixed', feedback: null };
    expect(() => report(state, base)).toThrow(/implementation/);
    const implementation = { files: ['form.ts'], resolutions: [], checks: [] };
    expect(() => report(state, { ...base, implementation })).toThrow(/R1/);
    const resolutions = [
      { id: 'R1', change: 'preserve raw source', tests: 'payload matrix passed' },
    ];
    expect(() =>
      report(state, { ...base, implementation: { ...implementation, resolutions } }),
    ).toThrow(/required check/);
    code(state);
  });

  it('validates duplicate IDs, whitespace evidence, bounds and mixed roles on internal calls', () => {
    const base = { verdict: 'rejected' as const, summary: 'review', feedback: 'defects' };
    expect(
      validateReport({ ...base, review: { findings: [finding(), finding()], resolved: [] } }),
    ).toMatch(/unique/);
    expect(
      validateReport({
        ...base,
        review: { findings: [finding('R1', { evidence: ' ' })], resolved: [] },
      }),
    ).toMatch(/non-empty/);
    expect(validateReport({ ...base, strategy: { summary: 's', slices: [] } })).toMatch(/slices/);
    expect(
      validateReport({
        ...base,
        review: { findings: Array.from({ length: 51 }, (_, i) => finding(`R${i}`)), resolved: [] },
      }),
    ).toMatch(/bounded/);
    expect(
      validateReport({
        ...base,
        review: { findings: [finding()], resolved: [] },
        strategy: { summary: 's', slices: [{ title: 't', acceptance: 'a' }] },
      }),
    ).toMatch(/exclusive/);
    expect(validateReport(base)).toBeNull();
  });
});
