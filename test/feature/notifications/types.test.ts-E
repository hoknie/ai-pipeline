import { describe, expect, it } from 'vitest';

import {
  acceptRecommendations,
  chatMessage,
  completeAnswers,
  decodeClosure,
  emptyDrafts,
  encodeClosure,
  missing,
  notificationEvents,
  parseTextAnswer,
  selectOption,
  setAnswer,
  tighten,
  truncate,
  withoutPaths,
  DEFAULT_LIMITS,
  type EventData,
  type QuestionData,
} from '../../../src/feature/notifications/types/index.ts';
import { finish, group, run, step } from '../runs/helpers.ts';

const questions: QuestionData[] = [
  { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
  { text: 'Add tests?', options: ['yes', 'no'], recommendation: null },
  { text: 'Name?', options: [], recommendation: 'main' },
];

function asking() {
  const state = run(1);
  step(state);
  finish(state, 'needs_human', {
    questions: [
      { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
    ],
    summary: 'plan ready',
  });
  return state;
}

describe('notification events', () => {
  it('turns an open question into a question event with its options', () => {
    const [event, ...rest] = notificationEvents(asking());
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ kind: 'question', run: 'run000000001', group: 'group-1' });
    expect(event?.data.questions).toEqual([
      { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
    ]);
    expect(event?.data.project).toBe('repo');
  });

  it('keeps a question for a person only, with its kind', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'please review', humanOnly: true });
    const [event] = notificationEvents(state);
    expect(event).toMatchObject({ kind: 'question' });
    expect(event?.data.question).toBe('please review');
  });

  it('gives a failed group a failed event with its reason', () => {
    const state = run(1);
    group(state).status = 'failed';
    group(state).reason = 'tests are red';
    const [event] = notificationEvents(state);
    expect(event).toMatchObject({ kind: 'failed' });
    expect(event?.data.reason).toBe('tests are red');
  });

  it('gives a conflict and a failed delivery their own kinds', () => {
    const state = run(2);
    group(state).status = 'conflict';
    group(state).conflictFiles = ['a.ts', 'b.ts'];
    group(state, 'group-2').status = 'merged';
    group(state, 'group-2').delivery.state = 'apply_failed';
    group(state, 'group-2').delivery.reason = 'dirty tree';
    const events = notificationEvents(state);
    expect(events.map((one) => one.kind).sort()).toEqual(['conflict', 'delivery']);
    expect(events.find((one) => one.kind === 'conflict')?.data.reason).toContain('a.ts, b.ts');
  });

  it('does not report a stopped usage limit', () => {
    const state = run(1);
    step(state);
    group(state).status = 'failed';
    group(state).attempts.at(-1)!.reason = { kind: 'usage_limit', resetsAt: null };
    expect(notificationEvents(state).map((one) => one.kind)).toEqual(['finished']);
  });

  it('reports the end of a task once with the number of merged groups', () => {
    const state = run(2);
    for (const one of state.groups) one.status = 'merged';
    state.run.finishedAt = 5000;
    const events = notificationEvents(state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'finished', group: null });
    expect(events[0]?.data).toMatchObject({ outcome: 'finished', merged: 2, groups: 2 });
  });

  it('reports a cancelled task as finished with the outcome cancelled', () => {
    const state = run(1);
    group(state).status = 'cancelled';
    state.run.finishedAt = 5000;
    const kinds = notificationEvents(state).map((one) => [one.kind, one.data.outcome]);
    expect(kinds).toEqual([['finished', 'cancelled']]);
  });

  it('makes the question of a new attempt a new event', () => {
    const state = asking();
    const first = notificationEvents(state)[0]!.key;
    step(state, 3000);
    group(state).status = 'queued';
    step(state, 3500);
    finish(state, 'needs_human', { questions: [{ text: 'Again?' }], now: 4000 });
    const second = notificationEvents(state)[0]!.key;
    expect(second).not.toBe(first);
  });

  it('keeps absolute paths out of the data', () => {
    const state = run(1);
    group(state).status = 'failed';
    group(state).reason = 'cannot write /repo/src/a.ts and /home/me/x/y.log';
    expect(notificationEvents(state)[0]?.data.reason).toBe('cannot write ./src/a.ts and y.log');
    expect(withoutPaths('see /var/tmp/x/file.txt now', '/repo')).toBe('see file.txt now');
  });
});

describe('drafts', () => {
  it('replaces the choice of a question', () => {
    let drafts = emptyDrafts(2);
    drafts = selectOption(questions, drafts, 0, 0)!;
    drafts = selectOption(questions, drafts, 0, 1)!;
    expect(drafts).toEqual(['PostgreSQL', null]);
    expect(selectOption(questions, drafts, 0, 5)).toBeNull();
  });

  it('accepts the recommendations only where there are any and keeps the choices', () => {
    const drafts = selectOption(questions, emptyDrafts(3), 0, 0)!;
    const accepted = acceptRecommendations(questions, setAnswer(drafts, 1, 'no'));
    expect(accepted).toEqual(['SQLite', 'no', 'main']);
    const withoutThird = acceptRecommendations(questions.slice(0, 2), emptyDrafts(2));
    expect(withoutThird).toEqual(['PostgreSQL', null]);
    expect(completeAnswers(2, withoutThird)).toBeNull();
    expect(missing(2, withoutThird)).toEqual([2]);
    expect(completeAnswers(3, accepted)).toEqual(['SQLite', 'no', 'main']);
  });
});

describe('parseTextAnswer', () => {
  it('reads N: text and N. text', () => {
    expect(parseTextAnswer('2: use PostgreSQL', 3)).toEqual({
      ok: true,
      answers: [{ index: 1, text: 'use PostgreSQL' }],
    });
    expect(parseTextAnswer('1. yes\n3. no', 3)).toEqual({
      ok: true,
      answers: [
        { index: 0, text: 'yes' },
        { index: 2, text: 'no' },
      ],
    });
  });

  it('continues an answer on the lines without a number', () => {
    expect(parseTextAnswer('1: first\nsecond line\n2: other', 2)).toEqual({
      ok: true,
      answers: [
        { index: 0, text: 'first\nsecond line' },
        { index: 1, text: 'other' },
      ],
    });
  });

  it('takes the whole text for one question or none', () => {
    expect(parseTextAnswer('да, конечно', 1)).toEqual({
      ok: true,
      answers: [{ index: 0, text: 'да, конечно' }],
    });
    expect(parseTextAnswer('1: да', 1)).toEqual({ ok: true, answers: [{ index: 0, text: 'да' }] });
    expect(parseTextAnswer('add tests\non errors', 0)).toEqual({
      ok: true,
      answers: [{ index: 0, text: 'add tests\non errors' }],
    });
  });

  it('refuses a text without a number for several questions and a number out of range', () => {
    expect(parseTextAnswer('да', 2)).toEqual({ ok: false });
    expect(parseTextAnswer('3: да', 2)).toEqual({ ok: false });
    expect(parseTextAnswer('0: да', 2)).toEqual({ ok: false });
    expect(parseTextAnswer('   ', 1)).toEqual({ ok: false });
    expect(parseTextAnswer('1:', 2)).toEqual({ ok: false });
  });
});

describe('limits', () => {
  it('shortens with an ellipsis and says so', () => {
    expect(truncate('abcdef', 10)).toEqual({ text: 'abcdef', cut: false });
    expect(truncate('abcdefghij', 5)).toEqual({ text: 'abcd…', cut: true });
  });

  it('tightens until nothing is left to cut', () => {
    let limits = DEFAULT_LIMITS;
    for (let step = 0; step < 20; step += 1) {
      const next = tighten(limits);
      if (next === null) break;
      limits = next;
    }
    expect(tighten(limits)).toBeNull();
    expect(limits.text).toBeLessThan(DEFAULT_LIMITS.text);
  });
});

function data(overrides: Partial<EventData> = {}): EventData {
  return {
    number: 7,
    title: 'Add login',
    project: 'app',
    pipeline: 'feature',
    group: 'login',
    groupTitle: 'Login form',
    step: 'plan',
    question: null,
    questions,
    humanOnly: null,
    summary: null,
    reason: null,
    outcome: null,
    merged: 0,
    groups: 1,
    asked: 0,
    ...overrides,
  };
}

const base = {
  kind: 'question' as const,
  run: 'mwky60yww0dh',
  closure: null,
  channel: 'main',
  language: 'en' as const,
  publicUrl: null,
};

describe('chatMessage', () => {
  it('shows every question with options, the recommendation and the buttons', () => {
    const message = chatMessage({ ...base, data: data(), drafts: emptyDrafts(3) });
    expect(message.state).toBe('open');
    expect(message.questions).toHaveLength(3);
    expect(message.questions[0]?.options.map((option) => option.recommended)).toEqual([
      false,
      true,
    ]);
    expect(message.rows.map((row) => row.map((action) => action.id))).toEqual([
      ['o:1:1', 'o:1:2'],
      ['o:2:1', 'o:2:2'],
      ['r', 'c'],
    ]);
    expect(message.link).toBeNull();
  });

  it('offers only a custom answer for a question without structure', () => {
    const message = chatMessage({
      ...base,
      data: data({ questions: null, question: 'What now?' }),
      drafts: emptyDrafts(0),
    });
    expect(message.body).toBe('What now?');
    expect(message.rows).toEqual([[{ id: 'c', label: 'Custom answer' }]]);
  });

  it('offers Accept and Rework for a review', () => {
    const message = chatMessage({
      ...base,
      data: data({ questions: null, humanOnly: 'review', summary: 'done' }),
      drafts: emptyDrafts(0),
      language: 'ru',
    });
    expect(message.headline).toBe('Ревью шага');
    expect(message.rows[0]?.map((action) => action.label)).toEqual(['Принять', 'Доработать']);
  });

  it('shows the chosen answers and what still waits', () => {
    const message = chatMessage({
      ...base,
      data: data(),
      drafts: ['PostgreSQL', 'no', null],
    });
    expect(message.questions.map((question) => question.answer)).toEqual([
      'PostgreSQL',
      'no',
      null,
    ]);
    expect(message.questions[0]?.options[1]?.selected).toBe(true);
    expect(message.status).toBe('Answered 2 of 3');
  });

  it('closes the message: no buttons and who closed it', () => {
    const message = chatMessage({
      ...base,
      data: data(),
      drafts: emptyDrafts(3),
      closure: { by: 'human' },
    });
    expect(message.state).toBe('closed');
    expect(message.rows).toEqual([]);
    expect(message.status).toContain('outside the bot');
    const other = chatMessage({
      ...base,
      data: data(),
      drafts: emptyDrafts(3),
      closure: { by: 'channel', channel: 'slack', user: '5' },
    });
    expect(other.status).toBe('Closed: answered via slack by user 5');
  });

  it('shows the answer as sent for the channel that sent it', () => {
    const message = chatMessage({
      ...base,
      data: data({ questions: questions.slice(0, 1) }),
      drafts: ['PostgreSQL'],
      closure: { by: 'channel', channel: 'main', user: '111' },
    });
    expect(message.state).toBe('answered');
    expect(message.status).toBe('Answer sent via main by user 111');
  });

  it('links to the group only with a public url', () => {
    const message = chatMessage({
      ...base,
      data: data(),
      drafts: emptyDrafts(3),
      publicUrl: 'https://aip.example.com',
    });
    expect(message.link).toBe('https://aip.example.com/#runs/mwky60yww0dh/login');
  });

  it('describes the end of a task and has no buttons for a failure', () => {
    const finished = chatMessage({
      ...base,
      kind: 'finished',
      data: data({ group: null, questions: null, outcome: 'finished', merged: 2, groups: 3 }),
      drafts: emptyDrafts(0),
    });
    expect(finished.body).toBe('finished, 2 of 3 groups merged');
    expect(finished.rows).toEqual([]);
    const failed = chatMessage({
      ...base,
      kind: 'failed',
      data: data({ questions: null, reason: 'tests are red' }),
      drafts: emptyDrafts(0),
    });
    expect(failed.body).toBe('tests are red');
    expect(failed.rows).toEqual([]);
  });

  it('shortens a long question with a notice and keeps every option', () => {
    const long: QuestionData = {
      text: 'x'.repeat(5000),
      options: ['a', 'b', 'c'],
      recommendation: null,
    };
    const message = chatMessage({
      ...base,
      data: data({ questions: [long] }),
      drafts: emptyDrafts(1),
    });
    expect(message.questions[0]?.text.endsWith('…')).toBe(true);
    expect(message.notice).not.toBeNull();
    expect(message.questions[0]?.options).toHaveLength(3);
  });
});

describe('closure records', () => {
  it('round-trips and reads a service mark as other', () => {
    const closure = { by: 'channel', channel: 'main', user: '1' } as const;
    expect(decodeClosure(encodeClosure(closure))).toEqual(closure);
    expect(decodeClosure('before_subscription')).toEqual({ by: 'other' });
    expect(decodeClosure(null)).toEqual({ by: 'other' });
  });
});
