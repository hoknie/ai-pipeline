import { describe, expect, it } from 'vitest';
import { transition } from '../../../../src/feature/runs/machine/index.ts';
import { finish, run } from '../helpers.ts';
import { openFindings, stagnantRounds } from '../../../../src/feature/runs/types/index.ts';
import { temporaryStorage } from '../../storage.ts';
import {
  atReview,
  code,
  complete,
  CONFIG,
  finding,
  group,
  review,
  revision,
  runningAttempt,
  step,
} from './helpers.ts';

describe('bounded review cycles', () => {
  it('preserves a human checkpoint on recovery and returns to the implementation after acceptance', () => {
    const state = run(1, {
      configText: CONFIG.replace(
        'id: plan, specialist: plan',
        'id: plan, specialist: plan, human_review: true',
      ),
    });
    step(state);
    finish(state, 'done');
    transition(state, { kind: 'answer', group: 'group-1', answer: 'Accept initial plan' }, 2000);
    step(state);
    finish(state, 'done');
    step(state);
    code(state);
    step(state);
    review(state, [finding()]);
    revision(state);
    revision(state);
    step(state);
    const recovery = {
      verdict: 'done' as const,
      summary: 'New approach',
      feedback: null,
      strategy: {
        summary: 'Use raw source',
        slices: [{ title: 'Preservation', acceptance: 'Raw values survive rename' }],
      },
    };
    complete(state, recovery);
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: 'review' });
    transition(state, { kind: 'answer', group: 'group-1', answer: 'Accept revised plan' }, 3000);
    step(state);
    expect(runningAttempt(state).input.review?.role).toBe('recovery');
    complete(state, recovery);
    expect(group(state).pending?.stepIndex).toBe(1);
  });
  it('changes strategy once after two unsuccessful revisions, then uses the configured stronger specialist', () => {
    const state = atReview();
    review(state, [finding()]);
    revision(state);
    expect(group(state).pending?.stepIndex).toBe(1);
    revision(state);
    expect(group(state).pending).toMatchObject({ stepIndex: 0, recoveryFor: 'review' });
    step(state);
    expect(runningAttempt(state).input.review?.role).toBe('recovery');
    complete(state, {
      verdict: 'done',
      summary: 'Replace normalized draft with raw source',
      feedback: null,
      strategy: {
        summary: 'Fix the preservation invariant before field controls',
        slices: [
          { title: 'Raw source model', acceptance: 'Null, number and missing keys survive rename' },
          { title: 'Explicit edits', acceptance: 'Only the selected key changes' },
        ],
      },
    });
    step(state);
    expect(runningAttempt(state)).toMatchObject({
      stepId: 'code',
      specialist: 'strong',
      model: 'openai/strong',
    });
    expect(runningAttempt(state).input.review?.strategy?.slices).toHaveLength(2);
    code(state);
    step(state);
    review(state, [finding()]);
    revision(state);
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: 'review_cycle' });
    expect(group(state).question).toContain('after strategy recovery');
  });

  it('resets stagnation only for verified closure of an old blocking ID', () => {
    const state = atReview();
    review(state, [finding('R1'), finding('R2')]);
    revision(state, [finding('R2')], ['R1']);
    expect(stagnantRounds(group(state), 'review')).toBe(0);
    revision(state, [
      finding('R2'),
      finding('R3', { origin: 'missed', reason: 'Missed another path' }),
    ]);
    expect(stagnantRounds(group(state), 'review')).toBe(1);
    expect(openFindings(group(state), 'review').map((item) => item.id)).toEqual(['R2', 'R3']);
  });

  it('honors the total limit before recovery, excludes observers and keeps protection after storage', () => {
    const state = atReview(CONFIG.replace('max_rounds: 8', 'max_rounds: 1'));
    review(state, [finding()]);
    revision(state);
    expect(group(state)).toMatchObject({
      status: 'needs_human',
      humanOnly: 'review_cycle',
      rejections: { review: 2 },
    });
    const store = temporaryStorage();
    try {
      store.runs.saveRun(state);
      const loaded = store.runs.loadRun(state.run.id)!;
      expect(group(loaded).humanOnly).toBe('review_cycle');
      expect(openFindings(group(loaded), 'review')).toEqual([finding()]);
      for (const by of ['observer', 'autopilot'] as const) {
        const before = structuredClone(loaded);
        expect(() =>
          transition(loaded, { kind: 'answer', group: 'group-1', answer: 'continue', by }, 3000),
        ).toThrow(/only for a person/);
        expect(loaded).toEqual(before);
      }
      transition(
        loaded,
        { kind: 'answer', group: 'group-1', answer: 'Try a raw source model' },
        3000,
      );
      expect(group(loaded).rejections.review).toBe(2);
      step(loaded);
      expect(runningAttempt(loaded).input.humanAnswer).toBe('Try a raw source model');
    } finally {
      store.database.close();
    }
  });

  it('asks the person on stagnation without a recovery step and accepts only minor suggestions', () => {
    const state = atReview(
      CONFIG.replace('recovery_step: plan, escalation_specialist: strong, ', ''),
    );
    review(state, [finding()]);
    revision(state);
    revision(state);
    expect(group(state).humanOnly).toBe('review_cycle');
    const minor = atReview();
    review(minor, [finding('M1', { severity: 'minor' })]);
    expect(group(minor).pending?.stepIndex).toBe(3);
  });
});
