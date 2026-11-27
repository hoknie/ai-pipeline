import { describe, expect, it } from 'vitest';
import { userMessage } from '../../../../src/feature/agents/types/index.ts';
import { buildInput } from '../../../../src/feature/runs/types/index.ts';
import { transition } from '../../../../src/feature/runs/machine/index.ts';
import { finish, run } from '../helpers.ts';
import {
  atReview,
  code,
  finding,
  group,
  report,
  review,
  revision,
  runningAttempt,
  step,
} from './helpers.ts';

describe('managed review context', () => {
  it('keeps only the latest report per step without deleting history or accepted decisions', () => {
    const state = atReview();
    review(state, [finding()]);
    const firstCode = group(state).attempts.find((attempt) => attempt.stepId === 'code')!;
    for (let i = 0; i < 20; i++)
      group(state).attempts.unshift({
        ...structuredClone(firstCode),
        seq: -i,
        report: { verdict: 'done', summary: `obsolete-${i}`, feedback: null },
      });
    group(state).decisions.push({
      stepId: 'plan',
      question: 'Browser checks?',
      answer: 'Leave manual checks to me',
      by: 'human',
    });
    const count = group(state).attempts.length;
    const input = buildInput(state.run, group(state), group(state).pending!);
    expect(input.previous.filter((item) => item.stepId === 'code')).toHaveLength(1);
    expect(userMessage(input)).not.toContain('obsolete-');
    expect(userMessage(input)).toContain('Leave manual checks to me');
    expect(input.feedback).toBeNull();
    expect(input.review?.findings).toEqual([finding()]);
    expect(group(state).attempts).toHaveLength(count);
  });

  it('leaves legacy inputs and reports unchanged', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    const copy = structuredClone(group(state).attempts[0]!);
    copy.seq = 2;
    group(state).attempts.push(copy);
    const input = buildInput(state.run, group(state), group(state).pending!);
    expect(input.previous).toHaveLength(2);
    expect(input.review).toBeUndefined();
  });

  it('keeps recovery role after a network failure and a retry', () => {
    const state = atReview();
    review(state, [finding()]);
    revision(state);
    revision(state);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'group-1',
        seq: attempt.seq,
        exit: {
          sessionId: 'replan-session',
          usage: null,
          failure: { kind: 'network', problem: 'offline' },
          outsideChanges: [],
        },
      },
      3000,
    );
    step(state, 40_000);
    expect(runningAttempt(state).input.review).toMatchObject({
      role: 'recovery',
      reviewerStep: 'review',
      findings: [finding()],
    });
  });

  it('cannot erase an open ledger through a question, and only reopens a closed ID as a regression', () => {
    const state = atReview();
    review(state, [finding()]);
    step(state);
    code(state);
    step(state);
    expect(() =>
      report(state, {
        verdict: 'needs_human',
        summary: 'Question',
        feedback: 'Decide',
        review: { findings: [], resolved: [] },
      }),
    ).toThrow(/cannot replace/);
    review(state, [], ['R1']);
    // A later quality step sends work back to the same implementation/reviewer pair.
    group(state).pending = { stepIndex: 1, feedback: 'Recheck', humanAnswer: null, resume: false };
    step(state);
    code(state);
    step(state);
    expect(() =>
      report(state, {
        verdict: 'rejected',
        summary: 'Reopened',
        feedback: null,
        review: { findings: [finding('R1', { origin: 'missed' })], resolved: [] },
      }),
    ).toThrow(/must be a regression/);
    review(state, [finding('R1', { origin: 'regression', reason: 'Repair was overwritten' })]);
  });
});
