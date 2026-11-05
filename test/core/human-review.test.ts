import { describe, expect, it } from 'vitest';

import {
  addItem,
  autopilotAnswers,
  buildInput,
  emptyQueue,
  itemStarted,
  reviewQuestion,
  startQueue,
  transition,
  validateReport,
  type Effect,
  type RunState,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from './helpers.ts';

const REVIEW_CONFIG = CONFIG_TEXT.replace(
  '- { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }',
  '- { id: review, specialist: reviewer, human_review: true, on_reject: { goto: code, max_rounds: 3 } }',
);
const LAST_CONFIG = CONFIG_TEXT.replace(
  '- { id: qa, specialist: qa }',
  '- { id: qa, specialist: qa, human_review: true }',
);

function kinds(effects: Effect[]): string[] {
  return effects.map((effect) => effect.kind);
}

function answer(state: RunState, text = 'Принято'): void {
  transition(state, { kind: 'answer', group: 'gruppa-1', answer: text }, 2500);
}

/** A run stopped on the review of its `review` step. */
function atReview(configText = REVIEW_CONFIG): RunState {
  const state = run(1, { configText });
  for (const _ of ['plan', 'code', 'review']) {
    step(state);
    finish(state, 'done', { summary: 'готово, смотри архитектуру' });
  }
  return state;
}

describe('reviewQuestion', () => {
  it('names the step and carries its summary', () => {
    const text = reviewQuestion('review', 'нет миграций');
    expect(text).toContain('`review`');
    expect(text).toContain('нет миграций');
    expect(text).toContain('review');
  });
});

describe('human review after done', () => {
  it('commits the step and asks the person instead of moving on', () => {
    const state = run(1, { configText: REVIEW_CONFIG });
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    const effects = finish(state, 'done', { summary: 'смотри архитектуру' });
    expect(kinds(effects)).toEqual(['commit']);
    expect(group(state)).toMatchObject({
      status: 'needs_human',
      humanOnly: 'review',
      questions: null,
      pending: { stepIndex: 2, resume: true },
    });
    expect(group(state).question).toContain('смотри архитектуру');
    expect(group(state).question).toContain('review');
  });

  it('does not stop a step without the flag', () => {
    const state = run(1);
    for (const _ of ['plan', 'code', 'review']) {
      step(state);
      finish(state, 'done');
    }
    expect(group(state)).toMatchObject({ status: 'queued', humanOnly: null });
  });

  it('stops the last step before the merge', () => {
    const state = atReview(LAST_CONFIG);
    step(state);
    expect(runningAttempt(state).stepId).toBe('qa');
    const effects = finish(state, 'done');
    expect(kinds(effects)).toEqual(['commit']);
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: 'review' });
    answer(state);
    step(state);
    expect(kinds(finish(state, 'done'))).toEqual(['commit', 'merge']);
    expect(group(state).status).toBe('merging');
  });

  it('resumes the same step on the answer, and its done goes on without a new review', () => {
    const state = atReview();
    answer(state, 'выглядит хорошо');
    expect(group(state)).toMatchObject({ status: 'queued', humanOnly: null, question: null });
    expect(group(state).pending).toMatchObject({ stepIndex: 2, reviewed: true });
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('review');
    expect(attempt.resumeSession).toBe('session-3');
    expect(attempt.input).toMatchObject({
      reviewed: true,
      humanReview: true,
      humanAnswer: 'выглядит хорошо',
    });
    finish(state, 'done');
    expect(group(state).status).toBe('queued');
    step(state);
    expect(runningAttempt(state).stepId).toBe('qa');
  });

  it('reviews again when the work comes back through on_reject', () => {
    const state = atReview();
    answer(state);
    step(state);
    finish(state, 'rejected', { feedback: 'нужны тесты' });
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
    expect(runningAttempt(state).input.reviewed).toBeUndefined();
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state).stepId).toBe('review');
    finish(state, 'done');
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: 'review' });
  });

  it('stops on the rounds limit without the marker', () => {
    const state = run(1, { configText: REVIEW_CONFIG.replace('max_rounds: 3', 'max_rounds: 1') });
    for (const id of ['plan', 'code', 'review', 'code', 'review']) {
      step(state);
      finish(state, id === 'review' ? 'rejected' : 'done', { feedback: 'плохо' });
    }
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: null });
  });

  it('builds the input with the flags', () => {
    const state = atReview();
    answer(state);
    const input = buildInput(state.run, group(state), group(state).pending!);
    expect(input).toMatchObject({ reviewed: true, humanReview: true });
    const plain = buildInput(state.run, group(run(1)), { ...group(run(1)).pending! });
    expect(plain.reviewed).toBeUndefined();
    expect(plain.humanReview).toBeUndefined();
  });

  it('is dropped when the step is skipped while the question waits', () => {
    const state = atReview();
    transition(state, { kind: 'step_skip', step: 'review', skip: true }, 3000);
    expect(group(state)).toMatchObject({ status: 'queued', humanOnly: null, question: null });
    expect(group(state).pending?.reviewed).toBeUndefined();
  });
});

describe('a request of the specialist', () => {
  it('marks the question human-only', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'Посмотри сам', humanOnly: true });
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: 'request' });
    expect(group(state).attempts[0]?.report?.humanOnly).toBe(true);
    answer(state, 'ок');
    expect(group(state).humanOnly).toBeNull();
    expect(group(state).pending?.reviewed).toBeUndefined();
  });

  it('leaves a plain question unmarked and does not store the flag', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'Какой вариант?' });
    expect(group(state).humanOnly).toBeNull();
    expect(group(state).attempts[0]?.report).not.toHaveProperty('humanOnly');
  });

  it('is allowed only with needs_human', () => {
    const base = { summary: 's', feedback: null, humanOnly: true } as const;
    expect(validateReport({ ...base, verdict: 'done' })).toBe(
      'human_only is allowed only when verdict is needs_human',
    );
    expect(validateReport({ ...base, verdict: 'rejected', feedback: 'x' })).toContain(
      'human_only is allowed only',
    );
    expect(validateReport({ ...base, verdict: 'needs_human', feedback: 'x' })).toBeNull();
  });

  it('is refused for a done report', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    expect(() =>
      transition(
        state,
        {
          kind: 'report',
          group: 'gruppa-1',
          seq: attempt.seq,
          report: { verdict: 'done', summary: 's', feedback: null, humanOnly: true },
        },
        2000,
      ),
    ).toThrow('human_only');
  });
});

describe('the reviewed mark survives interruptions', () => {
  function reviewedRun(): RunState {
    const state = atReview();
    answer(state);
    step(state);
    return state;
  }

  it('is kept when the usage limit makes the group wait', () => {
    const state = reviewedRun();
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 50_000 },
          outsideChanges: [],
        },
      },
      3000,
    );
    expect(group(state).pending).toMatchObject({ stepIndex: 2, reviewed: true });
    step(state, 60_000);
    finish(state, 'done');
    expect(group(state).status).toBe('queued');
  });

  it('is kept after a message of the person', () => {
    const state = reviewedRun();
    const attempt = runningAttempt(state);
    transition(
      state,
      { kind: 'message', group: 'gruppa-1', seq: attempt.seq, text: 'ещё одно' },
      3000,
    );
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: { sessionId: 's', usage: null, failure: null, outsideChanges: [] },
      },
      3500,
    );
    expect(group(state).pending).toMatchObject({ reviewed: true, resume: true });
    step(state);
    finish(state, 'done');
    expect(group(state).status).toBe('queued');
  });
});

describe('autopilot of the queue', () => {
  function queued(state: RunState) {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'A' }, 'q1', 2);
    queue.autoAnswer = true;
    startQueue(queue, [], 3);
    itemStarted(queue, 'q1', state.run.id, 4);
    return queue;
  }

  it('does not answer a review or a request of a specialist', () => {
    const review = atReview();
    expect(autopilotAnswers(queued(review), [review])).toEqual([]);
    const request = run(1);
    step(request);
    finish(request, 'needs_human', { feedback: 'Глянь', humanOnly: true });
    expect(autopilotAnswers(queued(request), [request])).toEqual([]);
  });

  it('answers a plain question after a review', () => {
    const state = atReview();
    answer(state);
    step(state);
    finish(state, 'needs_human', { feedback: 'Какой вариант?' });
    expect(group(state)).toMatchObject({ status: 'needs_human', humanOnly: null });
    expect(autopilotAnswers(queued(state), [state])).toHaveLength(1);
  });
});
