import { describe, expect, it } from 'vitest';

import type { Denial } from '../../../src/feature/agents/types/index.ts';
import type { Attempt, RunState } from '../../../src/feature/runs/types/index.ts';
import {
  LESSON_COUNT_LIMIT,
  LESSON_HEADER,
  RESOLVE_GROUP,
  collectSignal,
  emptySignal,
  lessonsFromSignal,
  newGroup,
  renderLessons,
  type Lesson,
} from '../../../src/feature/runs/types/index.ts';
import { run } from './helpers.ts';

const JAN_2 = Date.UTC(2026, 0, 2);

/** Two steps that reject the work and send it back to the coder in the same round. */
const TWO_REVIEW_CONFIG = `swarm:
  max: 5
  specialists:
    coder: { name: Coder }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review_a, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: review_b, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
`;

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    seq: 1,
    stepId: 'code',
    stepIndex: 0,
    round: 1,
    specialist: 'coder',
    runtime: 'claude',
    model: 'sonnet',
    generation: null,
    status: 'finished',
    input: {
      prompt: 'do it',
      groupTitle: 'Group 1',
      stepId: 'code',
      specialistName: 'Coder',
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    resumeSession: null,
    sessionId: null,
    report: { verdict: 'done', summary: 'done', feedback: null },
    reason: null,
    startedAt: 10,
    finishedAt: 20,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
    ...overrides,
  };
}

function finishedRun(id: string, number: number, attempts: Attempt[], finishedAt = 5000): RunState {
  const state = run(1, { id });
  state.run.number = number;
  state.run.finishedAt = finishedAt;
  state.groups[0]!.attempts.push(...attempts);
  return state;
}

/** The reviewer of the `review` step rejects the result: `on_reject` sends it back to the coder. */
function rejectedReview(overrides: Partial<Attempt> = {}): Attempt {
  return attempt({
    seq: 2,
    stepId: 'review',
    stepIndex: 2,
    specialist: 'reviewer',
    report: { verdict: 'rejected', summary: 'no', feedback: 'fix it' },
    ...overrides,
  });
}

function denial(tool: string, command: string | null = null): Denial {
  return { tool, command };
}

/** A review of the named step that rejects the work and sends it back to the coder. */
function rejectedStep(overrides: Partial<Attempt>): Attempt {
  return attempt({
    specialist: 'reviewer',
    report: { verdict: 'rejected', summary: 'no', feedback: 'fix it' },
    ...overrides,
  });
}

describe('collectSignal', () => {
  it('ignores runs that are not finished and attempts of commands', () => {
    const unfinished = finishedRun('open', 1, [attempt()], 5000);
    unfinished.run.finishedAt = null;
    const command = attempt({ specialist: 'action:lint', runtime: 'command' });
    const state = finishedRun('done', 2, [command, attempt()]);

    const signal = collectSignal([unfinished, state], 'coder');

    expect(signal.attempts).toBe(1);
    expect(signal.verdicts.done).toBe(1);
  });

  it('counts verdicts, rejected tasks, denials, outside changes and failed deliveries', () => {
    const first = finishedRun('first', 7, [
      attempt({
        denials: [denial('Bash', 'rm -rf build')],
        outsideChanges: ['/repo/base/lib.ts'],
      }),
      rejectedReview(),
    ]);
    first.groups[0]!.delivery = {
      ...first.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict in lib.ts',
      conflicts: ['lib.ts'],
      finishedAt: 4000,
    };
    const second = finishedRun('second', 8, [
      attempt({ denials: [denial('Bash', 'rm -rf build'), denial('Edit')] }),
    ]);

    const signal = collectSignal([first, second], 'coder');

    expect(signal.attempts).toBe(2);
    expect(signal.verdicts).toEqual({ done: 2, rejected: 0, needs_human: 0, failed: 0 });
    expect(signal.rejected).toMatchObject({ count: 1, tasks: [7], seenAt: 20 });
    expect(signal.denials.map((one) => one.tool)).toEqual(['Bash', 'Edit']);
    expect(signal.denials[0]).toMatchObject({ count: 2, tasks: [7, 8] });
    expect(signal.denials[0]!.commands).toEqual(['rm -rf build']);
    expect(signal.outside).toMatchObject({ count: 1, tasks: [7], paths: ['/repo/base/lib.ts'] });
    expect(signal.deliveries).toEqual([
      {
        state: 'apply_failed',
        count: 1,
        tasks: [7],
        seenAt: 4000,
        reasons: ['conflict in lib.ts'],
        conflicts: [{ path: 'lib.ts', count: 1 }],
        userEdits: [],
      },
    ]);
  });

  it('sums the tokens, counts conflicting files and user edits, and the rounds of rejections', () => {
    const first = finishedRun('first', 7, [
      attempt({ usage: { inputTokens: 10, outputTokens: 4 } }),
      rejectedReview({ round: 1 }),
      rejectedReview({ seq: 3, round: 2 }),
    ]);
    first.groups[0]!.delivery = {
      ...first.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict in a.ts',
      conflicts: ['a.ts', 'b.ts'],
      userEdits: ['c.ts'],
      finishedAt: 4000,
    };
    const second = finishedRun('second', 8, [
      attempt({ seq: 4, usage: { inputTokens: 5, outputTokens: 1 } }),
    ]);
    second.groups[0]!.delivery = {
      ...second.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict in a.ts',
      conflicts: ['a.ts'],
      userEdits: ['c.ts', 'd.ts'],
      finishedAt: 4500,
    };

    const signal = collectSignal([first, second], 'coder');

    expect(signal.usage).toEqual({ inputTokens: 15, outputTokens: 5 });
    expect(signal.rejected).toMatchObject({ count: 2, tasks: [7], rounds: 2 });
    const [delivery] = signal.deliveries;
    expect(delivery).toMatchObject({
      state: 'apply_failed',
      count: 2,
      tasks: [7, 8],
      reasons: ['conflict in a.ts'],
    });
    expect(delivery!.conflicts).toEqual([
      { path: 'a.ts', count: 2 },
      { path: 'b.ts', count: 1 },
    ]);
    expect(delivery!.userEdits).toEqual([
      { path: 'c.ts', count: 2 },
      { path: 'd.ts', count: 1 },
    ]);
  });

  it('counts two rejections of one round of a task as one round', () => {
    const state = run(1, { id: 'two-reviews', configText: TWO_REVIEW_CONFIG });
    state.run.number = 12;
    state.run.finishedAt = 5000;
    state.groups[0]!.attempts.push(
      attempt(),
      rejectedStep({ seq: 2, stepId: 'review_a', stepIndex: 1, round: 1 }),
      rejectedStep({ seq: 3, stepId: 'review_b', stepIndex: 2, round: 1 }),
    );

    const signal = collectSignal([state], 'coder');

    expect(signal.rejected).toMatchObject({ count: 2, tasks: [12], rounds: 1 });
  });

  it('leaves out service groups and actions: they say nothing about the specialist', () => {
    const state = finishedRun('done', 4, [attempt({ usage: { inputTokens: 1, outputTokens: 1 } })]);
    const resolve = newGroup(RESOLVE_GROUP, 'Resolve', 'resolve', 0);
    resolve.attempts.push(attempt({ seq: 9 }));
    resolve.delivery = {
      ...resolve.delivery,
      state: 'apply_failed',
      reason: 'conflict',
      conflicts: ['hidden.ts'],
      finishedAt: 100,
    };
    state.resolve = resolve;

    const signal = collectSignal([state], 'coder');

    expect(signal.attempts).toBe(1);
    expect(signal.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
    expect(signal.deliveries).toEqual([]);
  });

  it('reports an empty signal for a repository without finished runs', () => {
    expect(collectSignal([], 'coder')).toEqual(emptySignal('coder'));
    expect(emptySignal('coder')).toMatchObject({
      usage: null,
      deliveries: [],
      rejected: { count: 0, rounds: 0 },
    });
  });

  it('gives a rejected result to the author the review sends it back to, not to the reviewer', () => {
    const state = finishedRun('done', 9, [attempt(), rejectedReview()]);

    const coder = collectSignal([state], 'coder');
    const reviewer = collectSignal([state], 'reviewer');

    expect(coder.rejected).toMatchObject({ count: 1, tasks: [9], seenAt: 20 });
    expect(reviewer.rejected).toMatchObject({ count: 0, tasks: [], seenAt: 0 });
    expect(reviewer.verdicts.rejected).toBe(1);
  });

  it('does not count a cancelled attempt as a failure', () => {
    const state = finishedRun('done', 5, [
      attempt({ status: 'cancelled', report: null, reason: { kind: 'skipped' } }),
    ]);

    expect(collectSignal([state], 'coder').verdicts.failed).toBe(0);
  });

  it('reports an empty signal for a specialist without attempts', () => {
    const state = finishedRun('done', 3, [attempt()]);
    expect(collectSignal([state], 'reviewer')).toEqual(emptySignal('reviewer'));
  });
});

describe('lessonsFromSignal', () => {
  it('makes every lesson carry its occurrences, tasks and date', () => {
    const state = finishedRun('done', 42, [
      attempt({
        finishedAt: JAN_2,
        denials: [denial('Bash', 'rm -rf build')],
        outsideChanges: ['/repo/base/lib.ts'],
      }),
      rejectedReview({ finishedAt: JAN_2 }),
    ]);
    const lessons = lessonsFromSignal(collectSignal([state], 'coder'));
    const kinds = lessons.map((lesson) => lesson.kind);
    expect(kinds).toContain('rejected');
    expect(kinds).toContain('denial');
    expect(kinds).toContain('outside_changes');
    for (const lesson of lessons) {
      expect(lesson.evidence.occurrences).toBeGreaterThan(0);
      expect(lesson.evidence.tasks).toEqual([42]);
      expect(lesson.text).toContain('#42');
      expect(lesson.text).toContain('2026-01-02');
    }
  });

  it('describes a failed delivery as the result of the group, not of one specialist', () => {
    const state = finishedRun('done', 11, [attempt(), rejectedReview()]);
    state.groups[0]!.delivery = {
      ...state.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict in lib.ts',
      conflicts: ['lib.ts'],
      finishedAt: 4000,
    };

    const [lesson] = lessonsFromSignal(collectSignal([state], 'reviewer')).filter(
      (one) => one.kind === 'delivery',
    );

    expect(lesson!.text).toContain('Applying the result of the group failed');
    expect(lesson!.text).toContain('its changes agree with the base branch');
    expect(lesson!.text).not.toContain('your changes');
  });

  it('puts the most frequent and severe lessons first', () => {
    const state = finishedRun('done', 1, [
      attempt({
        denials: [denial('Bash')],
        outsideChanges: ['/repo/base/lib.ts'],
      }),
      attempt({ seq: 2, denials: [denial('Bash')] }),
      rejectedReview({ seq: 3 }),
    ]);
    state.groups[0]!.delivery = {
      ...state.groups[0]!.delivery,
      state: 'push_failed',
      reason: 'no network',
      finishedAt: 4000,
    };

    const lessons = lessonsFromSignal(collectSignal([state], 'coder'));

    expect(lessons[0]!.kind).toBe('denial');
  });
});

describe('renderLessons', () => {
  it('drops whole lessons by priority and never cuts one', () => {
    const lessons: Lesson[] = Array.from({ length: LESSON_COUNT_LIMIT + 4 }, (_, index) => ({
      id: `lesson-${index}`,
      kind: 'denial',
      text: `Lesson number ${index} is a whole sentence that stays whole.`,
      evidence: { occurrences: 1, tasks: [index], seenAt: JAN_2 },
      priority: 100 - index,
    }));

    const rendered = renderLessons(lessons, LESSON_HEADER.length + 200);

    expect(rendered.lessons.length).toBeGreaterThan(0);
    expect(rendered.lessons.length).toBeLessThanOrEqual(LESSON_COUNT_LIMIT);
    expect(rendered.lessons.length + rendered.dropped).toBe(lessons.length);
    for (const lesson of rendered.lessons) {
      expect(rendered.text.split('\n')).toContain(`- ${lesson.text}`);
    }
    expect(rendered.text.length).toBeLessThanOrEqual(LESSON_HEADER.length + 200);
  });

  it('returns no block when even the first lesson does not fit', () => {
    const lesson: Lesson = {
      id: 'one',
      kind: 'delivery',
      text: 'A lesson that is far too long for the limit.',
      evidence: { occurrences: 1, tasks: [1], seenAt: JAN_2 },
      priority: 10,
    };
    expect(renderLessons([lesson], LESSON_HEADER.length)).toMatchObject({ text: '', dropped: 1 });
  });

  it('returns an empty text without lessons', () => {
    expect(renderLessons([])).toMatchObject({ text: '', lessons: [], dropped: 0 });
  });
});
