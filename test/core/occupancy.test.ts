import { describe, expect, it } from 'vitest';

import {
  MESSAGE_GROUP,
  RESOLVE_GROUP,
  SPLIT_GROUP,
  newGroup,
  specialistUse,
  transition,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, run, step } from './helpers.ts';

const LIMITED = CONFIG_TEXT.replace(
  'coder: { name: Кодировщик, runtime: opencode, model: anthropic/sonnet }',
  'coder: { name: Кодировщик, runtime: opencode, model: anthropic/sonnet, max: 1 }',
);

const SERVICES = `${LIMITED}  delivery:
    mode: commit
    message_specialist: reviewer
    resolver: qa
`.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

describe('specialistUse', () => {
  it('lists a running and a waiting group of the same specialist with the limit', () => {
    const state = run(2, { configText: LIMITED });
    step(state);
    finish(state, 'done', { slug: 'gruppa-1' });
    finish(state, 'done', { slug: 'gruppa-2' });
    // both groups are on `code`; the limit lets only one run
    step(state);
    expect(specialistUse(state)).toMatchObject([
      {
        specialist: 'coder',
        level: 'project',
        max: 1,
        running: [
          {
            slug: 'gruppa-1',
            title: 'Группа 1',
            step: 'code',
            stepName: 'Кодировщик',
            startedAt: 1500,
          },
        ],
        waiting: [{ slug: 'gruppa-2', title: 'Группа 2', step: 'code', stepName: 'Кодировщик' }],
      },
    ]);
  });

  it('sorts by slug and takes the level and the limit from the configuration of the run', () => {
    const state = run(2, { configText: LIMITED });
    state.run.config.specialists.find((item) => item.slug === 'plan')!.level = 'global';
    step(state);
    const uses = specialistUse(state);
    expect(uses.map((use) => use.specialist)).toEqual(['plan']);
    expect(uses[0]).toMatchObject({ level: 'global', max: null });
    expect(uses[0]?.running.map((item) => item.slug)).toEqual(['gruppa-1', 'gruppa-2']);
  });

  it('counts the split, the commit message and the resolver', () => {
    const state = run(1, { configText: SERVICES, split: true });
    step(state);
    expect(specialistUse(state)).toMatchObject([
      { specialist: 'plan', running: [{ slug: SPLIT_GROUP, step: 'split' }] },
    ]);
    state.message = newGroup(MESSAGE_GROUP, 'commit message', 'x', 1_000_000);
    state.resolve = newGroup(RESOLVE_GROUP, 'resolve delivery conflicts', 'y', 1_000_001);
    const uses = specialistUse(state);
    expect(uses.map((use) => use.specialist)).toEqual(['plan', 'qa', 'reviewer']);
    expect(uses[1]?.waiting).toMatchObject([
      { slug: RESOLVE_GROUP, title: 'resolve delivery conflicts' },
    ]);
    expect(uses[2]?.waiting).toMatchObject([{ slug: MESSAGE_GROUP, step: 'message' }]);
  });

  it('is empty for a finished run and for a run that waits for a human', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'вопрос?' });
    expect(specialistUse(state)).toEqual([]);
    transition(state, { kind: 'cancel', group: null }, 10);
    expect(specialistUse(state)).toEqual([]);
  });
});
