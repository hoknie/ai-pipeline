import { describe, expect, it } from 'vitest';

import type {
  Attempt,
  ProbeExperiment,
  ProbeObservation,
  RunState,
} from '../../../src/feature/runs/types/index.ts';
import {
  compareExperiment,
  isSignificant,
  observeRun,
  planProbes,
  probeId,
  scoreOf,
  signTestP,
  sourceSkip,
  versusOf,
} from '../../../src/feature/runs/types/index.ts';

import { config, group, run } from './helpers.ts';

function experiment(overrides: Partial<ProbeExperiment> = {}): ProbeExperiment {
  return {
    id: 'pr1',
    repository: '/repo',
    sourceRun: 'r1',
    sourceGroup: 'group-1',
    groupTitle: 'Group 1',
    split: false,
    pipeline: 'feature',
    task: 'do it',
    baseCommit: 'abc',
    provider: null,
    skip: [],
    candidates: ['default', 'strong'],
    repetitions: 6,
    budget: { maxRuns: 12, maxTokens: null },
    planned: 12,
    stopped: null,
    stopReason: null,
    runs: [],
    createdAt: 0,
    proposalPath: null,
    ...overrides,
  };
}

function observation(
  candidate: string,
  repetition: number,
  clean: boolean,
  extra: Partial<ProbeObservation> = {},
): ProbeObservation {
  return {
    candidate,
    repetition,
    runId: `${candidate}-${repetition}`,
    finished: true,
    groups: 1,
    merged: 1,
    conflicts: 0,
    clean,
    denials: 0,
    outsideChanges: 0,
    verdicts: { done: clean ? 1 : 0, rejected: clean ? 0 : 1, needs_human: 0 },
    tokens: 10,
    error: null,
    ...extra,
  };
}

function cleanPair(candidate: string, repetitions: number, clean: boolean): ProbeObservation[] {
  return Array.from({ length: repetitions }, (_, index) =>
    observation(candidate, index + 1, clean),
  );
}

function probeRun(id: string, merged: boolean): RunState {
  const state = run(1, { id });
  const work = group(state);
  work.status = merged ? 'merged' : 'failed';
  if (merged) work.mergeCommit = 'merge';
  return state;
}

function withAttempt(state: RunState): RunState {
  const work = group(state);
  work.attempts.push({
    status: 'finished',
    usage: { inputTokens: 3, outputTokens: 4 },
    denials: [{ tool: 'bash' }],
    outsideChanges: ['../outside.ts'],
    report: { verdict: 'done', summary: 'done', feedback: null },
  } as unknown as Attempt);
  return state;
}

describe('the plan of a contrast probe', () => {
  it('plans every candidate on the same task and base, repetition by repetition', () => {
    const plan = planProbes({
      sourceRun: 'r1',
      sourceGroup: 'group-1',
      repository: '/repo',
      pipeline: 'feature',
      task: 'do it',
      baseCommit: 'abc',
      candidates: [' default ', 'strong'],
      repetitions: 2,
      budget: { maxRuns: 4 },
    });
    expect(plan.candidates).toEqual(['default', 'strong']);
    expect(plan.baseCommit).toBe('abc');
    expect(plan.task).toBe('do it');
    expect(plan.runs).toEqual([
      { candidate: 'default', repetition: 1 },
      { candidate: 'default', repetition: 2 },
      { candidate: 'strong', repetition: 1 },
      { candidate: 'strong', repetition: 2 },
    ]);
  });

  it('needs a baseline and one more candidate', () => {
    expect(() =>
      planProbes({
        sourceRun: 'r1',
        sourceGroup: 'group-1',
        repository: '/repo',
        pipeline: 'feature',
        task: 'do it',
        baseCommit: 'abc',
        candidates: ['default'],
        repetitions: 1,
        budget: { maxRuns: 4 },
      }),
    ).toThrow(/at least two candidates/);
  });

  it('refuses a candidate listed twice', () => {
    expect(() =>
      planProbes({
        sourceRun: 'r1',
        sourceGroup: 'group-1',
        repository: '/repo',
        pipeline: 'feature',
        task: 'do it',
        baseCommit: 'abc',
        candidates: ['default', 'default'],
        repetitions: 1,
        budget: { maxRuns: 4 },
      }),
    ).toThrow(/listed twice/);
  });

  it('refuses a plan above the run budget instead of widening it', () => {
    expect(() =>
      planProbes({
        sourceRun: 'r1',
        sourceGroup: 'group-1',
        repository: '/repo',
        pipeline: 'feature',
        task: 'do it',
        baseCommit: 'abc',
        candidates: ['default', 'strong'],
        repetitions: 3,
        budget: { maxRuns: 5 },
      }),
    ).toThrow(/above the budget/);
  });

  it('refuses a hard limit above the limit of one experiment', () => {
    expect(() =>
      planProbes({
        sourceRun: 'r1',
        sourceGroup: 'group-1',
        repository: '/repo',
        pipeline: 'feature',
        task: 'do it',
        baseCommit: 'abc',
        candidates: ['default', 'strong'],
        repetitions: 1,
        budget: { maxRuns: 101 },
      }),
    ).toThrow(/at most 100/);
  });
});

describe('the skips the probes repeat', () => {
  const SOURCE_PIPELINE = `swarm:
  max: 5
  specialists:
    planner: { name: Planner }
    coder: { name: Coder }
    reviewer: { name: Reviewer }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: planner }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
        - { id: qa, specialist: reviewer }
      variants:
        lean:
          skip: [review]
`;

  const DRIFTED_PIPELINE = SOURCE_PIPELINE.replace(
    '        - { id: qa, specialist: reviewer }\n',
    '        - { id: qa, specialist: reviewer }\n        - { id: deploy, specialist: coder }\n',
  );

  it('skips the steps the current configuration added and the ones skipped after the start', () => {
    const state = run(1, { id: 'r1', configText: SOURCE_PIPELINE, variant: 'lean' });
    state.run.skippedSteps = ['plan'];
    // The snapshot of the run lacks the variant skip `review`, yet the probes compare harnesses: the
    // skip of the source variant is not forced onto them. `deploy` appeared after the run started and
    // `plan` was skipped after it, so both keep the step set of the source.
    expect(sourceSkip(config(DRIFTED_PIPELINE), state)).toEqual(['deploy', 'plan']);
  });

  it('repeats nothing when the configuration and the snapshot agree', () => {
    const state = run(1, { id: 'r1', configText: SOURCE_PIPELINE });
    expect(sourceSkip(config(SOURCE_PIPELINE), state)).toEqual([]);
  });
});

describe('the exact sign test of the comparison', () => {
  it('gives the chance of an unbiased coin to split the decided pairs this unevenly', () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(6, 0)).toBeCloseTo(0.03125);
    expect(signTestP(5, 1)).toBeCloseTo(0.21875);
    expect(signTestP(0, 6)).toBeCloseTo(0.03125);
  });

  it('trusts a difference only with enough decided pairs and a small p', () => {
    expect(isSignificant(6, 0)).toBe(true);
    expect(isSignificant(0, 6)).toBe(true);
    expect(isSignificant(5, 0)).toBe(false);
    expect(isSignificant(5, 1)).toBe(false);
  });
});

describe('the observation of one probe run', () => {
  it('counts nothing for a run that is not there or not finished', () => {
    const missing = observeRun({ candidate: 'a', repetition: 1, runId: 'x' }, null, null);
    expect(missing.finished).toBe(false);
    expect(missing.clean).toBe(false);
    const pending = run(1);
    const unfinished = observeRun(
      { candidate: 'a', repetition: 1, runId: pending.run.id },
      pending,
      { applied: true, conflicts: [] },
    );
    expect(unfinished.finished).toBe(false);
  });

  it('is clean only when every group merged and the result applies cleanly on the base', () => {
    const state = withAttempt(probeRun('r1', true));
    const clean = observeRun({ candidate: 'a', repetition: 1, runId: 'r1' }, state, {
      applied: true,
      conflicts: [],
    });
    expect(clean).toMatchObject({
      finished: true,
      groups: 1,
      merged: 1,
      conflicts: 0,
      clean: true,
      denials: 1,
      outsideChanges: 1,
      tokens: 7,
      verdicts: { done: 1, rejected: 0, needs_human: 0 },
    });
    const conflict = observeRun({ candidate: 'a', repetition: 1, runId: 'r1' }, state, {
      applied: false,
      conflicts: ['a.ts'],
    });
    expect(conflict.clean).toBe(false);
    expect(conflict.conflicts).toBe(1);
  });

  it('is not clean when a group failed', () => {
    const state = probeRun('r1', false);
    const failed = observeRun({ candidate: 'a', repetition: 1, runId: 'r1' }, state, {
      applied: true,
      conflicts: [],
    });
    expect(failed).toMatchObject({ finished: true, merged: 0, clean: false });
  });

  it('records a check that could not run as an error, not as a conflict', () => {
    const state = probeRun('r1', true);
    const errored = observeRun(
      { candidate: 'a', repetition: 1, runId: 'r1' },
      state,
      null,
      'bad object name',
    );
    expect(errored).toMatchObject({
      finished: true,
      clean: false,
      conflicts: 0,
      error: 'bad object name',
    });
  });

  it('leaves errored probes out of the clean rate and counts them apart', () => {
    const score = scoreOf('default', [
      observation('default', 1, true),
      observation('default', 2, false, { error: 'bad object name' }),
    ]);
    expect(score).toMatchObject({ runs: 2, finished: 2, errors: 1, clean: 1, cleanRate: 1 });
  });
});

describe('the comparison of the probes', () => {
  it('adds the signal of each candidate over its runs', () => {
    const score = scoreOf('default', [
      observation('default', 1, true, { tokens: 5 }),
      observation('default', 2, false, { tokens: 7, conflicts: 2, denials: 1 }),
    ]);
    expect(score).toMatchObject({
      runs: 2,
      finished: 2,
      clean: 1,
      conflicts: 2,
      denials: 1,
      tokens: 12,
      cleanRate: 0.5,
    });
  });

  it('pairs the repetitions of a candidate with the baseline, one bit per pair', () => {
    const observations = [
      observation('default', 1, false),
      observation('strong', 1, true),
      observation('default', 2, true),
      observation('strong', 2, true),
      observation('default', 3, false),
      observation('strong', 3, false),
    ];
    expect(versusOf('strong', 'default', observations, 3)).toMatchObject({
      pairs: 3,
      wins: 1,
      losses: 0,
      ties: 2,
    });
  });

  it('is running while any probe is unfinished and writes no proposal yet', () => {
    const observations = [
      ...cleanPair('default', 6, false),
      ...cleanPair('strong', 5, true),
      observation('strong', 6, true, { finished: false }),
    ];
    const comparison = compareExperiment(experiment(), observations);
    expect(comparison.status).toBe('running');
    expect(comparison.winner).toBeNull();
    expect(comparison.proposal).toBeNull();
  });

  it('names a candidate that delivers cleanly significantly more often than the baseline', () => {
    const observations = [...cleanPair('default', 6, false), ...cleanPair('strong', 6, true)];
    const comparison = compareExperiment(experiment(), observations);
    expect(comparison.status).toBe('ready');
    expect(comparison.winner).toBe('strong');
    expect(comparison.versus).toMatchObject([{ wins: 6, losses: 0, significant: true }]);
    expect(comparison.proposal?.markdown).toContain('use variant `strong`');
    expect(comparison.proposal?.markdown).toContain('probes never apply anything');
    expect(comparison.proposal?.markdown).not.toMatch(/apply --|aip apply/);
    expect(comparison.proposal?.markdown).toContain('baseline `default`: clean 0/6 (0%)');
    expect(comparison.proposal?.markdown).toContain('`strong`: clean 6/6 (100%)');
  });

  it('keeps the baseline when every candidate is significantly worse', () => {
    const observations = [...cleanPair('default', 6, true), ...cleanPair('strong', 6, false)];
    const comparison = compareExperiment(experiment(), observations);
    expect(comparison.winner).toBe('default');
    expect(comparison.reason).toContain('worse');
  });

  it('reports no winner when the difference is not significant', () => {
    const observations = [...cleanPair('default', 3, true), ...cleanPair('strong', 3, true)];
    const comparison = compareExperiment(experiment({ repetitions: 3 }), observations);
    expect(comparison.status).toBe('ready');
    expect(comparison.winner).toBeNull();
    expect(comparison.reason).toContain('no significant difference');
  });

  it('reports the budget as exhausted instead of a winner when the tokens ran over', () => {
    const observations = [
      observation('default', 1, true, { tokens: 50 }),
      observation('strong', 1, true, { tokens: 60 }),
    ];
    const comparison = compareExperiment(
      experiment({ repetitions: 1, budget: { maxRuns: 2, maxTokens: 100 } }),
      observations,
    );
    expect(comparison.status).toBe('budget_exhausted');
    expect(comparison.winner).toBeNull();
    expect(comparison.spent.tokens).toBe(110);
    expect(comparison.reason).toContain('above the budget');
  });

  it('keeps a probe whose check failed out of the pairs instead of calling it a loss', () => {
    const observations = [
      ...cleanPair('default', 6, true),
      ...cleanPair('strong', 6, false).map((entry) => ({ ...entry, error: 'bad object name' })),
    ];
    const comparison = compareExperiment(experiment(), observations);
    expect(comparison.status).toBe('ready');
    expect(comparison.versus[0]).toMatchObject({
      pairs: 0,
      wins: 0,
      losses: 0,
      significant: false,
    });
    expect(comparison.scores[1]).toMatchObject({ finished: 6, errors: 6, cleanRate: 0 });
    // The clean rate of a probe whose check failed divides by the probes it could check, not by all.
    expect(comparison.proposal?.markdown).toContain('`strong`: clean 0/0 (0%)');
    expect(comparison.winner).toBeNull();
    expect(comparison.reason).toContain('could not be checked');
  });

  it('reports an experiment that stopped creating probes as inconclusive, without a proposal', () => {
    const observations = [...cleanPair('default', 2, true), ...cleanPair('strong', 2, true)].map(
      (entry, index) => ({ ...entry, runId: `run-${index}` }),
    );
    const comparison = compareExperiment(
      experiment({
        planned: 12,
        stopped: 'tokens',
        budget: { maxRuns: 12, maxTokens: 100 },
        runs: observations.map((entry, index) => ({
          runId: entry.runId,
          candidate: entry.candidate,
          repetition: entry.repetition,
        })),
      }),
      observations,
    );
    expect(comparison.status).toBe('budget_exhausted');
    expect(comparison.winner).toBeNull();
    expect(comparison.reason).toContain('stopped creating probes after 4 of 12');
    expect(comparison.proposal?.what).toBe('no change: the experiment ran over its token budget');
  });

  it('has no proposal for an experiment whose probes did not start', () => {
    const comparison = compareExperiment(experiment({ planned: 12, stopped: 'creation_failed' }), [
      observation('default', 1, true),
    ]);
    expect(comparison.status).toBe('failed');
    expect(comparison.winner).toBeNull();
    expect(comparison.proposal).toBeNull();
    expect(comparison.reason).toContain('1 of 12');
  });

  it('keeps the experiment id free of the ids of runs', () => {
    expect(probeId(0, 0)).toMatch(/^pr[0-9a-z]{12}$/);
    expect(probeId(1, 2)).not.toBe(probeId(1, 3));
  });
});
