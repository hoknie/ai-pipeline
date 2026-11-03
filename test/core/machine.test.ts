import { describe, expect, it } from 'vitest';

import {
  QUESTIONS_LIMIT,
  lastUnskipped,
  questionsText,
  runName,
  summarize,
  transition,
  validateReport,
  type Effect,
  type HumanQuestion,
} from '../../src/core/index.ts';

import { finish, group, run, runningAttempt, step } from './helpers.ts';

function kinds(effects: Effect[]): string[] {
  return effects.map((effect) => effect.kind);
}

describe('skipped steps', () => {
  it('goes to the merge after the last remaining step', () => {
    const state = run(1, { skip: ['review', 'qa'] });
    step(state);
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
    expect(kinds(finish(state, 'done'))).toEqual(['commit', 'merge']);
    expect(group(state).status).toBe('merging');
  });

  it('keeps a rejection going back to code', () => {
    const state = run(1, { skip: ['qa'] });
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    expect(runningAttempt(state).stepId).toBe('review');
    finish(state, 'rejected', { feedback: 'плохо' });
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
  });
});

describe('step order', () => {
  it('starts the next step of the same group after done', () => {
    const state = run(1);
    step(state);
    expect(runningAttempt(state).stepId).toBe('plan');
    const effects = finish(state, 'done');
    expect(kinds(effects)).toEqual(['commit']);
    expect(group(state).status).toBe('queued');
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
  });

  it('enqueues the merge after the last step and merges', () => {
    const state = run(1);
    for (const _ of ['plan', 'code', 'review']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    const effects = finish(state, 'done');
    expect(kinds(effects)).toEqual(['commit', 'merge']);
    expect(group(state).status).toBe('merging');
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c1' } },
      3000,
    );
    expect(group(state).status).toBe('merged');
    expect(state.run.finishedAt).toBe(3000);
  });
});

describe('rejections', () => {
  function toReview() {
    const state = run(1);
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    return state;
  }

  it('returns to the goto step with the feedback of the rejecting specialist', () => {
    const state = toReview();
    finish(state, 'rejected', { feedback: 'нет тестов' });
    expect(group(state).pending).toMatchObject({ stepIndex: 1, feedback: 'нет тестов' });
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('code');
    expect(attempt.round).toBe(2);
    expect(attempt.input.feedback).toBe('нет тестов');
  });

  it('asks a human once max_rounds is exceeded', () => {
    const state = toReview();
    for (let round = 1; round <= 3; round += 1) {
      finish(state, 'rejected');
      step(state);
      finish(state, 'done');
      step(state);
    }
    finish(state, 'rejected', { feedback: 'опять' });
    expect(group(state).status).toBe('needs_human');
    expect(group(state).question).toContain('4 times (limit 3)');
    expect(step(state)).toEqual([]);
  });

  it('asks a human when a step without on_reject rejects', () => {
    const state = run(1);
    step(state);
    finish(state, 'rejected', { feedback: 'непонятно' });
    expect(group(state).status).toBe('needs_human');
    expect(group(state).question).toBe('непонятно');
  });
});

describe('questions to a human', () => {
  it('reruns the same step with the answer and resumes the session', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'OAuth или пароль?' });
    expect(group(state)).toMatchObject({ status: 'needs_human', question: 'OAuth или пароль?' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'используй OAuth' }, 2500);
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('plan');
    expect(attempt.input.humanAnswer).toBe('используй OAuth');
    expect(attempt.resumeSession).toBe('session-1');
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
  });

  it('keeps the human decision for every later step of the group', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'needs_human', { feedback: 'Как назвать функцию?' });
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'Name it double' }, 2500);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'rejected', { feedback: 'нужен JSDoc' });
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('code');
    expect(attempt.input.humanAnswer).toBeNull();
    expect(attempt.input.decisions).toEqual([
      { stepId: 'code', question: 'Как назвать функцию?', answer: 'Name it double', by: 'human' },
    ]);
  });

  it('rejects an answer for a group that is not waiting and an empty answer', () => {
    const state = run(1);
    expect(() => transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'x' }, 1)).toThrow(
      'needs needs_human',
    );
    expect(() => transition(state, { kind: 'answer', group: 'gruppa-1', answer: ' ' }, 1)).toThrow(
      'must not be empty',
    );
  });

  function exitWithOutsideChange(state: ReturnType<typeof run>) {
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq: attempt.seq,
        report: { verdict: 'done', summary: 's', feedback: null },
      },
      2,
    );
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: { sessionId: null, usage: null, failure: null, outsideChanges: ['README.md'] },
      },
      3,
    );
  }

  it('warns and continues by default when files outside the worktree changed', () => {
    const state = run(1);
    exitWithOutsideChange(state);
    expect(group(state).status).toBe('queued');
    expect(group(state).warnings).toEqual([]);
    expect(group(state).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });

  it('asks a human about changes outside the worktree with outside_changes: stop', () => {
    const state = run(1);
    state.run.config.outsideChanges = 'stop';
    exitWithOutsideChange(state);
    expect(group(state).status).toBe('needs_human');
    expect(group(state).question).toContain('README.md');
    expect(group(state).question).not.toContain('The specialist changed');
    expect(group(state).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });
});

describe('failures', () => {
  it('fails the step and the group on timeout and stops the process', () => {
    const state = run(2);
    step(state);
    const effects = transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 9000);
    expect(effects).toEqual([
      { kind: 'stop_attempt', run: state.run.id, group: 'gruppa-1', seq: 1 },
    ]);
    expect(group(state)).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(group(state, 'gruppa-2').status).toBe('running');
  });

  it('fails with no report when the process exits without swarm_report', () => {
    const state = run(1);
    step(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: { sessionId: null, usage: null, failure: null, outsideChanges: [] },
      },
      2,
    );
    expect(group(state)).toMatchObject({ status: 'failed', reason: 'no report' });
  });

  it('retries only the failed step with the same input', () => {
    const state = run(1);
    for (const _ of ['plan', 'code', 'review']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 4 }, 9000);
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 9100);
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('qa');
    expect(attempt.seq).toBe(5);
    expect(group(state).attempts.filter((candidate) => candidate.stepId === 'plan')).toHaveLength(
      1,
    );
  });

  it('refuses to retry a group that has not failed', () => {
    const state = run(1);
    expect(() => transition(state, { kind: 'retry', group: 'gruppa-1' }, 1)).toThrow(
      'needs failed, cancelled or conflict',
    );
  });

  it('marks running attempts interrupted after a daemon restart', () => {
    const state = run(2, { max: 1 });
    step(state);
    transition(state, { kind: 'interrupted' }, 5);
    expect(group(state)).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(group(state, 'gruppa-2').status).toBe('queued');
  });
});

describe('cancellation', () => {
  it('stops running specialists and cancels every group of the run', () => {
    const state = run(3, { max: 2 });
    step(state);
    const effects = transition(state, { kind: 'cancel', group: null }, 10);
    expect(kinds(effects)).toEqual(['stop_attempt', 'stop_attempt']);
    expect(state.groups.map((candidate) => candidate.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(state.run.finishedAt).toBe(10);
  });

  it('rejects a report for a cancelled attempt', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'cancel', group: 'gruppa-1' }, 10);
    expect(() =>
      transition(
        state,
        {
          kind: 'report',
          group: 'gruppa-1',
          seq: 1,
          report: { verdict: 'done', summary: 's', feedback: null },
        },
        11,
      ),
    ).toThrow('not running');
    expect(group(state).status).toBe('cancelled');
  });
});

describe('reports', () => {
  it('keeps the last report of an attempt', () => {
    const state = run(1);
    step(state);
    const report = { summary: 's', feedback: 'f' };
    transition(
      state,
      { kind: 'report', group: 'gruppa-1', seq: 1, report: { verdict: 'rejected', ...report } },
      2,
    );
    transition(
      state,
      { kind: 'report', group: 'gruppa-1', seq: 1, report: { verdict: 'done', ...report } },
      3,
    );
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: { sessionId: null, usage: null, failure: null, outsideChanges: [] },
      },
      4,
    );
    expect(group(state).attempts[0]?.report?.verdict).toBe('done');
    expect(group(state).status).toBe('queued');
  });

  it('requires feedback for rejected and needs_human', () => {
    const state = run(1);
    step(state);
    expect(() =>
      transition(
        state,
        {
          kind: 'report',
          group: 'gruppa-1',
          seq: 1,
          report: { verdict: 'rejected', summary: 's', feedback: null },
        },
        2,
      ),
    ).toThrow('feedback is required');
  });
});

describe('run names', () => {
  it('takes the first title it gets and counts the usage of naming', () => {
    const state = run(1);
    expect(state.run).toMatchObject({ title: null, name: null });
    const usage = { inputTokens: 30, outputTokens: 10, costUsd: 0.002 };
    transition(state, { kind: 'run_named', title: 'Вход', name: 'login', usage }, 10);
    transition(state, { kind: 'run_named', title: 'Другое', name: 'other', usage: null }, 20);
    expect(state.run).toMatchObject({ title: 'Вход', name: 'login', namingUsage: usage });
    expect(summarize(state).usage).toEqual(usage);
  });

  it('records the usage of a failed naming call without a title', () => {
    const state = run(1);
    const usage = { inputTokens: 5, outputTokens: 0, costUsd: 0.001 };
    transition(state, { kind: 'run_named', title: null, name: null, usage }, 10);
    expect(state.run).toMatchObject({ title: null, name: null, namingUsage: usage });
  });

  it('derives the name from a title given at the start', () => {
    expect(runName('Вход по OAuth')).toBe('vhod-po-oauth');
    expect(runName('Fix: the --json flag!')).toBe('fix-the-json-flag');
    expect(runName('???')).toBe('run');
    expect(runName('a'.repeat(60))).toHaveLength(40);
  });
});

const asked: HumanQuestion[] = [
  { text: 'OAuth или пароль?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
  { text: 'Где хранить сессии?', recommendation: 'в базе' },
];

describe('structured questions', () => {
  it('validates questions in a report', () => {
    const base = { verdict: 'needs_human', summary: 's', feedback: null } as const;
    expect(validateReport({ ...base, questions: asked })).toBeNull();
    expect(validateReport({ ...base, questions: [] })).toContain('1 to');
    expect(
      validateReport({
        ...base,
        questions: Array.from({ length: QUESTIONS_LIMIT + 1 }, () => ({ text: 'q' })),
      }),
    ).toContain('questions must contain');
    expect(validateReport({ ...base, questions: [{ text: ' ' }] })).toContain('text');
    expect(validateReport({ ...base, questions: [{ text: 'q', options: [''] }] })).toContain(
      'options',
    );
    expect(validateReport({ ...base, questions: [{ text: 'q', options: [] }] })).toContain(
      '1 to 6',
    );
    expect(
      validateReport({
        ...base,
        questions: [{ text: 'q', options: Array.from({ length: 7 }, (_, i) => `o${i}`) }],
      }),
    ).toContain('1 to 6');
    expect(
      validateReport({
        ...base,
        questions: [{ text: 'q', options: Array.from({ length: 6 }, (_, i) => `o${i}`) }],
      }),
    ).toBeNull();
    expect(
      validateReport({ ...base, questions: [{ text: 'q', recommendation: 'x'.repeat(2000) }] }),
    ).toBeNull();
    expect(
      validateReport({ ...base, questions: [{ text: 'q', recommendation: 'x'.repeat(2001) }] }),
    ).toContain('at most 2000');
    expect(validateReport({ ...base, questions: [{ text: 'q', recommendation: ' ' }] })).toContain(
      'recommendation',
    );
    expect(validateReport({ ...base, verdict: 'rejected', questions: asked })).toContain(
      'only when verdict is needs_human',
    );
    expect(validateReport({ ...base, verdict: 'done', questions: asked })).toContain(
      'only when verdict is needs_human',
    );
    expect(validateReport(base)).toContain('feedback is required');
  });

  it('renders questions as a numbered text', () => {
    expect(questionsText(asked)).toBe(
      '1. OAuth или пароль?\n   Options: OAuth | пароль\n   Recommended: OAuth\n2. Где хранить сессии?\n   Recommended: в базе',
    );
    expect(questionsText([{ text: 'Просто вопрос' }])).toBe('1. Просто вопрос');
  });

  it('keeps questions on the group, fills the text and clears them on answer', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { questions: asked });
    expect(group(state).status).toBe('needs_human');
    expect(group(state).questions).toEqual(asked);
    expect(group(state).question).toBe(questionsText(asked));
    transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'Q1: OAuth' }, 2500);
    expect(group(state).questions).toBeNull();
    expect(group(state).question).toBeNull();
    expect(group(state).decisions[0]?.question).toBe(questionsText(asked));
  });

  it('keeps questions after cancel and retry', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { questions: asked });
    transition(state, { kind: 'cancel', group: 'gruppa-1' }, 10);
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 11);
    expect(group(state).status).toBe('needs_human');
    expect(group(state).questions).toEqual(asked);
  });

  it('has no questions for a plain question to a human', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'обычный вопрос' });
    expect(group(state).questions).toBeNull();
  });
});

describe('tags_set', () => {
  it('changes only the tags of a finished run, with no effects', () => {
    const state = run(1);
    transition(state, { kind: 'cancel', group: null }, 10);
    const before = JSON.stringify({ ...state, run: { ...state.run, tags: [] } });
    const effects = transition(state, { kind: 'tags_set', tags: ['tg-a', 'tg-b'] }, 20);
    expect(effects).toEqual([]);
    expect(state.run.tags).toEqual(['tg-a', 'tg-b']);
    expect(JSON.stringify({ ...state, run: { ...state.run, tags: [] } })).toBe(before);
  });

  it('works on an active run and does not touch the groups', () => {
    const state = run(1);
    step(state);
    const groups = JSON.stringify(state.groups);
    expect(transition(state, { kind: 'tags_set', tags: ['tg-a'] }, 20)).toEqual([]);
    expect(state.run.tags).toEqual(['tg-a']);
    expect(JSON.stringify(state.groups)).toBe(groups);
    transition(state, { kind: 'tags_set', tags: [] }, 30);
    expect(state.run.tags).toEqual([]);
  });
});

describe('step_skip', () => {
  const skip = (state: ReturnType<typeof run>, stepId: string, on = true) =>
    transition(state, { kind: 'step_skip', step: stepId, skip: on }, 3000);

  it('skips an upcoming step: it is never started', () => {
    const state = run(1);
    step(state);
    skip(state, 'review');
    expect(state.run.skippedSteps).toEqual(['review']);
    finish(state, 'done');
    step(state);
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state).stepId).toBe('qa');
  });

  it('stops a running step without a commit and moves on', () => {
    const state = run(1);
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('review');
    const effects = skip(state, 'review');
    expect(kinds(effects)).toContain('stop_attempt');
    expect(kinds(effects)).not.toContain('commit');
    const stopped = group(state).attempts.find((candidate) => candidate.seq === attempt.seq)!;
    expect(stopped.status).toBe('cancelled');
    expect(stopped.reason).toEqual({ kind: 'skipped' });
    expect(group(state).pending?.stepIndex).toBe(3);
    step(state);
    expect(runningAttempt(state).stepId).toBe('qa');
  });

  it('goes to the merge when the remaining steps are skipped', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    finish(state, 'done');
    skip(state, 'review');
    const effects = skip(state, 'qa');
    expect(kinds(effects)).toContain('merge');
    expect(group(state).status).toBe('merging');
  });

  it('drops the question of a step skipped while it waits for a human', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { questions: [{ text: 'Что?' }] as HumanQuestion[] });
    expect(group(state).status).toBe('needs_human');
    skip(state, 'plan');
    expect(group(state).question).toBeNull();
    step(state);
    expect(runningAttempt(state).stepId).toBe('code');
  });

  it('refuses a step every group has passed, without changing the state', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    const before = JSON.stringify(state);
    expect(() => skip(state, 'plan')).toThrow('already passed');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('refuses an unknown step, a goto target and skipping everything', () => {
    const state = run(1);
    expect(() => skip(state, 'nope')).toThrow('unknown step');
    expect(() => skip(state, 'code')).toThrow('returns to skipped step');
    skip(state, 'qa');
    skip(state, 'review');
    skip(state, 'code', false);
    expect(state.run.skippedSteps).toEqual(['review', 'qa']);
  });

  it('is idempotent and can be turned off', () => {
    const state = run(1);
    skip(state, 'qa');
    skip(state, 'qa');
    expect(state.run.skippedSteps).toEqual(['qa']);
    skip(state, 'qa', false);
    expect(state.run.skippedSteps).toEqual([]);
  });

  it('puts a conflict update on the last unskipped step', () => {
    const state = run(1);
    skip(state, 'qa');
    expect(state.run.skippedSteps).toEqual(['qa']);
    expect(lastUnskipped(state.run, group(state))).toBe(2);
  });
});
