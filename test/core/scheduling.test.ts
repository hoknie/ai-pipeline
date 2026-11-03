import { describe, expect, it } from 'vitest';

import {
  GROUP_STATUSES,
  dispatch,
  formatCounts,
  groupSlugs,
  planDispatch,
  RUN_ID_LENGTH,
  runId,
  runningBySpecialist,
  slugify,
  summarize,
  transition,
  type RunState,
} from '../../src/core/index.ts';
import { isValidSlug } from '../../src/config/index.ts';

import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from './helpers.ts';

describe('step input', () => {
  it('gives code after a rejection the summaries of plan, the previous code and the feedback', () => {
    const state = run(1);
    step(state);
    finish(state, 'done', { summary: 'план готов' });
    step(state);
    finish(state, 'done', { summary: 'код v1' });
    step(state);
    finish(state, 'rejected', { summary: 'ревью: ошибки', feedback: 'нет тестов' });
    step(state);
    const input = runningAttempt(state).input;
    expect(input.previous.map((previous) => previous.summary)).toEqual([
      'план готов',
      'код v1',
      'ревью: ошибки',
    ]);
    expect(input.feedback).toBe('нет тестов');
    expect(input.stepId).toBe('code');
    expect(input.specialistName).toBe('Кодировщик');
  });

  it('builds the prompt from the specialist prompt and the group task', () => {
    const state = run(1);
    step(state);
    expect(runningAttempt(state).input.prompt).toBe('План: задача 1');
    expect(runningAttempt(state).input.groupTitle).toBe('Группа 1');
  });

  it('takes runtime and model from the specialist', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state)).toMatchObject({ runtime: 'opencode', model: 'anthropic/sonnet' });
  });
});

describe('additional prompt of a step', () => {
  const TEXT = CONFIG_TEXT.replace(
    '        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }',
    '        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 }, additional_prompt: Проверяй только тесты }\n        - { id: final, specialist: reviewer }',
  );

  it('appends the text of the step after the specialist prompt, only in that step', () => {
    const state = run(1, { configText: TEXT });
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
    }
    step(state);
    const review = runningAttempt(state).input.prompt;
    expect(review.endsWith('задача 1\n\nПроверяй только тесты')).toBe(true);
    finish(state, 'done');
    step(state);
    expect(runningAttempt(state).stepId).toBe('final');
    expect(runningAttempt(state).input.prompt).not.toContain('Проверяй только тесты');
  });

  it('keeps the prompt of runs saved before the field existed', () => {
    const fresh = run(1);
    const old = run(1);
    for (const workflow of old.run.config.workflows) {
      for (const entry of workflow.steps)
        delete (entry as { additionalPrompt?: unknown }).additionalPrompt;
    }
    step(fresh);
    step(old);
    expect(runningAttempt(old).input.prompt).toBe(runningAttempt(fresh).input.prompt);
  });
});

describe('scheduler', () => {
  it('runs at most max specialists and keeps the rest queued', () => {
    const state = run(8, { max: 5 });
    const effects = step(state);
    expect(effects).toHaveLength(5);
    expect(state.groups.filter((candidate) => candidate.status === 'running')).toHaveLength(5);
    expect(state.groups.filter((candidate) => candidate.status === 'queued')).toHaveLength(3);
  });

  it('serves the earlier run first and groups in their order', () => {
    const later = run(2, { id: 'run000000002', now: 2000 });
    const earlier = run(2, { id: 'run000000001', now: 1000 });
    const effects = dispatch([later, earlier], 3, 3000);
    expect(
      effects.map((effect) =>
        effect.kind === 'start_attempt' ? `${effect.run}/${effect.group}` : '',
      ),
    ).toEqual(['run000000001/gruppa-1', 'run000000001/gruppa-2', 'run000000002/gruppa-1']);
  });

  it('counts running specialists across runs', () => {
    const first = run(2, { id: 'run000000001' });
    const second = run(2, { id: 'run000000002', now: 2000 });
    dispatch([first], 2, 1);
    expect(dispatch([first, second], 3, 2)).toHaveLength(1);
  });
});

describe('specialist limit', () => {
  const LIMITED = CONFIG_TEXT.replace(
    'coder: { name: Кодировщик,',
    'coder: { name: Кодировщик, max: 1,',
  );

  function startedBy(effects: ReturnType<typeof dispatch>, state: RunState): string[] {
    return effects.flatMap((effect) =>
      effect.kind === 'start_attempt'
        ? [`${effect.group}:${runningAttemptOf(state, effect.group)}`]
        : [],
    );
  }

  function runningAttemptOf(state: RunState, slug: string): string {
    return runningAttempt(state, slug).specialist;
  }

  function planned(groups: number, options: { id?: string; now?: number } = {}): RunState {
    const state = run(groups, { configText: LIMITED, ...options });
    step(state);
    for (let index = 1; index <= groups; index++)
      finish(state, 'done', { slug: `gruppa-${index}` });
    return state;
  }

  it('counts running attempts by specialist across runs', () => {
    const first = run(2, { id: 'run000000001' });
    const second = run(1, { id: 'run000000002', now: 2000 });
    dispatch([first, second], 5, 1);
    expect(runningBySpecialist([first, second])).toEqual(new Map([['plan', 3]]));
  });

  it('lets one coder work and starts the next group when it finishes', () => {
    const state = planned(3);
    const effects = step(state);
    expect(startedBy(effects, state)).toEqual(['gruppa-1:coder']);
    expect(state.groups.map((entry) => entry.status)).toEqual(['running', 'queued', 'queued']);
    finish(state, 'done', { slug: 'gruppa-1' });
    expect(startedBy(step(state), state)).toContain('gruppa-2:coder');
    expect(group(state, 'gruppa-3').status).toBe('queued');
  });

  it('does not block specialists without a limit behind a waiting group', () => {
    const state = run(3, { configText: LIMITED, max: 2 });
    step(state);
    finish(state, 'done', { slug: 'gruppa-1' });
    step(state);
    expect(runningAttempt(state, 'gruppa-1').specialist).toBe('coder');
    finish(state, 'done', { slug: 'gruppa-2' });
    expect(startedBy(step(state), state)).toEqual(['gruppa-3:plan']);
    expect(group(state, 'gruppa-2').status).toBe('queued');
  });

  it('applies the limit across runs', () => {
    const first = run(1, { id: 'run000000001', configText: LIMITED });
    step(first);
    finish(first, 'done');
    dispatch([first], 5, 1600);
    const second = run(1, { id: 'run000000002', now: 2000, configText: LIMITED });
    dispatch([first, second], 5, 1700);
    finish(second, 'done');
    expect(runningAttempt(first).specialist).toBe('coder');
    expect(dispatch([first, second], 5, 1800)).toEqual([]);
    expect(group(second).status).toBe('queued');
    finish(first, 'done');
    dispatch([first, second], 5, 1900);
    expect(runningAttempt(second).specialist).toBe('coder');
  });

  it('starts exactly one of two groups waiting for a limited specialist in one call', () => {
    const state = planned(2);
    expect(step(state)).toHaveLength(1);
  });

  it('starts as many specialists as max allows when there is no limit', () => {
    const state = run(6, { max: 5 });
    expect(step(state)).toHaveLength(5);
  });
});

describe('merge queue', () => {
  function readyToMerge(groups: number) {
    const state = run(groups);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      for (const candidate of state.groups) finish(state, 'done', { slug: candidate.slug });
    }
    return state;
  }

  it('merges one group at a time in the order they finished', () => {
    const state = readyToMerge(2);
    expect(state.groups.map((candidate) => [candidate.status, candidate.mergeInFlight])).toEqual([
      ['merging', true],
      ['merging', false],
    ]);
    const effects = transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c1' } },
      5,
    );
    expect(effects).toEqual([
      { kind: 'merge', run: state.run.id, group: 'gruppa-2', updateOnConflict: false },
    ]);
  });

  it('marks a conflict with its files and moves on to the next group', () => {
    const state = readyToMerge(2);
    const effects = transition(
      state,
      {
        kind: 'merge_finished',
        group: 'gruppa-1',
        outcome: { kind: 'conflict', files: ['src/lib.ts'] },
      },
      5,
    );
    expect(group(state)).toMatchObject({ status: 'conflict', conflictFiles: ['src/lib.ts'] });
    expect(effects.map((effect) => effect.kind)).toEqual(['merge']);
  });

  it('retries a conflict by merging again with branch update', () => {
    const state = readyToMerge(1);
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'conflict', files: ['a'] } },
      5,
    );
    const effects = transition(state, { kind: 'retry', group: 'gruppa-1' }, 6);
    expect(effects).toEqual([
      { kind: 'merge', run: state.run.id, group: 'gruppa-1', updateOnConflict: true },
    ]);
    transition(
      state,
      {
        kind: 'merge_finished',
        group: 'gruppa-1',
        outcome: { kind: 'conflict_updated', files: ['a'] },
      },
      7,
    );
    step(state);
    const attempt = runningAttempt(state);
    expect(attempt.stepId).toBe('qa');
    expect(attempt.input.feedback).toContain('merge conflicts in: a');
  });

  it('merges after a manual resolution on retry', () => {
    const state = readyToMerge(1);
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'conflict', files: ['a'] } },
      5,
    );
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 6);
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c1' } },
      7,
    );
    expect(group(state).status).toBe('merged');
  });
});

describe('summary', () => {
  it('finishes a run with one failed group and counts statuses', () => {
    const state = run(3);
    state.groups[0]!.status = 'merged';
    state.groups[1]!.status = 'merged';
    state.groups[2]!.status = 'failed';
    const summary = summarize(state);
    expect(summary.finished).toBe(true);
    expect(summary.counts.merged).toBe(2);
    expect(summary.total).toBe(3);
    expect(formatCounts(summary)).toBe('merged 2 · failed 1');
  });

  it('keeps a run active while a group needs a human', () => {
    const state = run(2);
    state.groups[0]!.status = 'merged';
    state.groups[1]!.status = 'needs_human';
    expect(summarize(state).finished).toBe(false);
  });

  it('uses snake_case status names', () => {
    expect(GROUP_STATUSES).toEqual([
      'queued',
      'running',
      'needs_human',
      'merging',
      'merged',
      'conflict',
      'failed',
      'cancelled',
    ]);
  });
});

describe('identifiers', () => {
  it('transliterates Cyrillic titles', () => {
    expect(slugify('Добавить логин')).toBe('dobavit-login');
    expect(slugify('Ёжик в тумане!')).toBe('ezhik-v-tumane');
  });

  it('prefixes titles that do not start with a letter', () => {
    expect(slugify('2FA для входа')).toBe('g-2fa-dlya-vhoda');
    expect(slugify('')).toBe('g');
    expect(slugify('!!!')).toBe('g');
  });

  it('cuts long titles to a valid slug', () => {
    const slug = slugify('очень длинный заголовок группы '.repeat(4));
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('suffixes duplicate titles', () => {
    expect(groupSlugs(['Логин', 'логин', 'ЛОГИН'])).toEqual(['login', 'login-2', 'login-3']);
  });

  it('makes fixed-length run ids that sort by time', () => {
    const earlier = runId(1_700_000_000_000, 5);
    const later = runId(1_700_000_000_001, 0);
    expect(earlier).toHaveLength(RUN_ID_LENGTH);
    expect(earlier < later).toBe(true);
    expect(earlier).toMatch(/^[0-9a-z]+$/);
  });
});

describe('dispatch and the plan', () => {
  it('starts exactly the groups of the plan and leaves the waiting ones queued', () => {
    const first = run(3, {
      id: 'run000000001',
      configText: CONFIG_TEXT.replace(
        'coder: { name: Кодировщик,',
        'coder: { name: Кодировщик, max: 1,',
      ),
    });
    step(first);
    for (let index = 1; index <= 3; index++) finish(first, 'done', { slug: `gruppa-${index}` });
    const plan = planDispatch([first], 5, 1500);
    const effects = dispatch([first], 5, 1500);
    expect(effects.map((effect) => (effect.kind === 'start_attempt' ? effect.group : ''))).toEqual(
      plan.start.map((entry) => entry.group.slug),
    );
    for (const key of plan.waits.keys()) {
      const slug = key.split('/')[1];
      expect(first.groups.find((entry) => entry.slug === slug)?.status).toBe('queued');
    }
  });
});
