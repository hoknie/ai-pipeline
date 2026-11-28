import { describe, expect, it } from 'vitest';
import {
  compareHarnessProbes,
  formatHarnessProposal,
  type ProbeSummary,
} from '../../../src/feature/runs/types/probe/harness-comparison.ts';

function probe(runId: string, overrides: Partial<ProbeSummary> = {}): ProbeSummary {
  return {
    runId,
    task: 'same task',
    baseCommit: 'abc',
    actualDelivery: 'not_attempted',
    allGroupsMerged: true,
    check: { applied: true, conflicts: 0, error: null },
    outsideChanges: 0,
    denials: 0,
    reviewerGroups: [],
    reviewerAttempts: [],
    cost: 1,
    wallMs: 1000,
    attemptDurationMs: 900,
    inputTokens: 1200,
    outputTokens: 200,
    ...overrides,
  };
}

describe('harness probe comparison', () => {
  it('keeps the baseline on a tie even when the candidate is cheaper', () => {
    expect(compareHarnessProbes(probe('a'), probe('b', { cost: 0 })).recommendation).toBe(
      'baseline',
    );
  });

  it('prefers a working check but never breaks a check tie using conflicts', () => {
    const broken = probe('a', { check: { applied: false, conflicts: 3, error: null } });
    expect(compareHarnessProbes(broken, probe('b')).recommendation).toBe('candidate');
    const conflicts = probe('a', { check: { applied: true, conflicts: 2, error: null } });
    expect(compareHarnessProbes(conflicts, probe('b')).recommendation).toBe('baseline');
  });

  it('does not prefer a cheaper broken candidate', () => {
    const candidate = probe('b', { cost: 0, check: { applied: false, conflicts: 1, error: null } });
    expect(compareHarnessProbes(probe('a'), candidate).recommendation).toBe('baseline');
  });

  it('does not prefer a partially merged candidate even when its isolated check passes', () => {
    const baseline = probe('a', { check: { applied: false, conflicts: 1, error: null } });
    const candidate = probe('b', { allGroupsMerged: false });
    const result = compareHarnessProbes(baseline, candidate);
    expect(result.recommendation).toBe('baseline');
    expect(formatHarnessProposal(result)).toContain('| All groups merged | true | false |');
  });

  it('does not treat incomplete baseline merging as a check advantage', () => {
    const baseline = probe('a', { allGroupsMerged: false });
    expect(compareHarnessProbes(baseline, probe('b')).recommendation).toBe('baseline');
    const broken = probe('b', { check: { applied: false, conflicts: 1, error: null } });
    expect(compareHarnessProbes(baseline, broken).recommendation).toBe('baseline');
    expect(compareHarnessProbes(baseline, broken).reason).toContain('candidate');
  });

  it('stops on candidate outside changes even with missing checks', () => {
    expect(
      compareHarnessProbes(
        probe('a'),
        probe('b', {
          outsideChanges: 1,
          check: { applied: null, conflicts: null, error: 'failed' },
        }),
      ).recommendation,
    ).toBe('stop');
  });

  it('returns unknown for missing or failed checks and incomparable runs', () => {
    for (const candidate of [
      probe('b', { check: { applied: null, conflicts: null, error: null } }),
      probe('b', { check: { applied: true, conflicts: 0, error: 'failed' } }),
      probe('b', { baseCommit: 'other' }),
      probe('b', { task: null }),
      probe('a'),
    ])
      expect(compareHarnessProbes(probe('a'), candidate).recommendation).toBe('unknown');
  });

  it('maps reviewer attempts using history semantics and counts rounds', () => {
    const candidate = probe('b', {
      reviewerGroups: ['group-1'],
      reviewerAttempts: [
        { group: 'group-1', round: 1, seq: 1, status: 'finished', verdict: 'rejected' },
        { group: 'group-1', round: 1, seq: 2, status: 'failed', verdict: 'done' },
        { group: 'group-1', round: 2, seq: 3, status: 'finished', verdict: 'done' },
      ],
    });
    const result = compareHarnessProbes(probe('a'), candidate);
    expect(result.reviewers.candidate).toEqual(['done']);
    expect(result.rounds).toEqual({ baseline: null, candidate: 2 });
  });

  it('evaluates local attempts per group, independently of group order', () => {
    const reviewerAttempts: ProbeSummary['reviewerAttempts'] = [
      { group: 'a', round: 1, seq: 1, status: 'finished', verdict: 'done' },
      { group: 'b', round: 1, seq: 1, status: 'finished', verdict: 'rejected' },
    ];
    const candidate = probe('b', { reviewerGroups: ['b', 'a'], reviewerAttempts });
    const result = compareHarnessProbes(probe('a'), candidate);
    expect(result.reviewOutcome.candidate).toBe('rejected');
    expect(result.rounds.candidate).toBeNull();
    expect(formatHarnessProposal(result)).toContain('| Review a | unknown | done; rounds: 1 |');
    expect(formatHarnessProposal(result)).toContain(
      '| Review b | unknown | rejected; rounds: unknown |',
    );
    reviewerAttempts.push({ group: 'b', round: 2, seq: 2, status: 'finished', verdict: 'done' });
    const done = compareHarnessProbes(probe('a'), candidate);
    expect(done.reviewOutcome.candidate).toBe('done');
    expect(done.rounds.candidate).toBe(2);
    expect(formatHarnessProposal(done)).toContain('| Review b | unknown | done; rounds: 2 |');
    expect(
      compareHarnessProbes(probe('a'), { ...candidate, reviewerGroups: ['a', 'b'] }).reviewGroups,
    ).toEqual(done.reviewGroups);
    expect(
      compareHarnessProbes(probe('a'), { ...candidate, reviewerGroups: ['a', 'b', 'c'] })
        .reviewOutcome.candidate,
    ).toBe('unknown');
  });

  it('formats escaped ids, unknown metrics and the hypothetical check', () => {
    const text = formatHarnessProposal(
      compareHarnessProbes(
        probe('<a>|x'),
        probe('b', { cost: null, wallMs: null, inputTokens: null }),
      ),
    );
    expect(text).toContain('&lt;a&gt;\\|x');
    expect(text).toContain('1,200');
    expect(text).toContain('| Cost | 1 | unknown |');
    expect(text).toContain('check is hypothetical');
    expect(text).toContain('Nothing is automatically applied');
  });

  it('stays a description of one pair: no change proposal and no delivery claim', () => {
    // A strict advantage of the candidate in the single pair: the pair signal names it, the
    // proposal of a change comes only from the repetitions of the experiment.
    const winning = compareHarnessProbes(
      probe('a', { check: { applied: false, conflicts: 1, error: null } }),
      probe('b'),
    );
    expect(winning.recommendation).toBe('candidate');
    const offered = formatHarnessProposal(winning);
    expect(offered).toContain('Pair signal: **candidate**');
    expect(offered).toContain('actualDelivery: not_attempted');
    expect(offered).toContain('Nothing is automatically applied');
    expect(offered).toContain('This is not a recommendation to apply a change');
    expect(offered).not.toMatch(/use variant/i);
    // Savings alone never overturn the check tie, and nothing is claimed as delivered.
    const cheaper = compareHarnessProbes(
      probe('a'),
      probe('b', { cost: 0, wallMs: 1, inputTokens: 1, outputTokens: 1 }),
    );
    expect(cheaper.recommendation).toBe('baseline');
    const saved = formatHarnessProposal(cheaper);
    expect(saved).toContain('Pair signal: **baseline**');
    expect(saved).toContain('actualDelivery: not_attempted');
    expect(saved).not.toMatch(/use variant/i);
  });
});
