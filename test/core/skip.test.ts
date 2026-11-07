import { describe, expect, it } from 'vitest';

import {
  applySkip,
  checkSkip,
  cleanSkip,
  isSkipped,
  lastUnskipped,
  nextUnskipped,
  stepStates,
  stepsOf,
} from '../../src/core/index.ts';
import { findPipeline } from '../../src/feature/swarm-config/types/index.ts';

import { CONFIG_TEXT, config, finish, group, run, step } from './helpers.ts';

const EPIC_CONFIG = `${CONFIG_TEXT.trimEnd()}
    explore:
      steps:
        - { id: look, specialist: plan }
        - { id: check, specialist: reviewer, on_reject: { goto: look, max_rounds: 2 } }
    epic:
      split: { specialist: plan, max_groups: 3, pipeline: explore }
`;

function ids(text: string, pipeline: string, skip: string[]): string[] {
  const resolved = applySkip(config(text), pipeline, skip);
  const found = findPipeline(resolved, pipeline)!;
  return (found.split?.pipeline ? findPipeline(resolved, found.split.pipeline)! : found).steps.map(
    (step) => step.id,
  );
}

describe('cleanSkip', () => {
  it('collapses repeats and keeps the order', () => {
    expect(cleanSkip(['qa', 'review', 'qa'])).toEqual(['qa', 'review']);
  });
});

describe('checkSkip', () => {
  const resolved = config();

  it('accepts an empty list and review with qa', () => {
    expect(checkSkip(resolved, 'feature', [])).toBeNull();
    expect(checkSkip(resolved, 'feature', ['review', 'qa'])).toBeNull();
    expect(checkSkip(resolved, 'feature', ['qa'])).toBeNull();
  });

  it('names the steps when one is unknown', () => {
    expect(checkSkip(resolved, 'feature', ['deploy'])).toBe(
      'unknown step `deploy` in skip; steps: plan, code, review, qa',
    );
  });

  it('does not accept the name of a step in place of its id', () => {
    expect(checkSkip(config(CONFIG_TEXT), 'feature', ['Планировщик'])).toMatch(
      /^unknown step `Планировщик` in skip/,
    );
  });

  it('refuses to skip every step', () => {
    expect(checkSkip(resolved, 'feature', ['plan', 'code', 'review', 'qa'])).toBe(
      'skip leaves no steps',
    );
  });

  it('refuses a step that returns to a skipped step', () => {
    expect(checkSkip(resolved, 'feature', ['code'])).toBe(
      'step `review` returns to skipped step `code`',
    );
  });

  it('refuses an unknown pipeline', () => {
    expect(checkSkip(resolved, 'nope', ['qa'])).toBe('unknown pipeline `nope`');
  });
});

describe('applySkip', () => {
  it('returns the same configuration for an empty skip', () => {
    const resolved = config();
    expect(applySkip(resolved, 'feature', [])).toBe(resolved);
  });

  it('removes the steps without changing the original', () => {
    const resolved = config();
    expect(ids(CONFIG_TEXT, 'feature', ['review', 'qa', 'qa'])).toEqual(['plan', 'code']);
    applySkip(resolved, 'feature', ['qa']);
    expect(findPipeline(resolved, 'feature')!.steps).toHaveLength(4);
  });

  it('cuts the steps of split.pipeline', () => {
    expect(ids(EPIC_CONFIG, 'epic', ['check'])).toEqual(['look']);
    expect(() => applySkip(config(EPIC_CONFIG), 'epic', ['plan'])).toThrow(/unknown step `plan`/);
  });

  it('is applied by createRun to the snapshot', () => {
    const state = run(1, { skip: ['review', 'qa'] });
    expect(stepsOf(state.run, state.groups[0]!).map((step) => step.id)).toEqual(['plan', 'code']);
    expect(() => run(1, { skip: ['deploy'] })).toThrow(/unknown step/);
  });
});

describe('stepStates', () => {
  it('marks the first step active and the rest upcoming for a fresh run', () => {
    const state = run(1);
    expect(stepStates(state).map((entry) => entry.state)).toEqual([
      'active',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('marks passed steps done and follows the slowest group', () => {
    const state = run(2);
    step(state);
    finish(state, 'done');
    finish(state, 'done', { slug: 'gruppa-2' });
    step(state);
    finish(state, 'done');
    expect(stepStates(state).map((entry) => entry.state)).toEqual([
      'done',
      'active',
      'active',
      'upcoming',
    ]);
  });

  it('marks every step done after the merge and flags skipped steps', () => {
    const state = run(1);
    state.run.skippedSteps = ['qa'];
    for (const item of state.groups) item.status = 'merged';
    const states = stepStates(state);
    expect(states.every((entry) => entry.state === 'done')).toBe(true);
    expect(states.map((entry) => entry.skipped)).toEqual([false, false, false, true]);
  });

  it('names a step after its specialist, or by the slug without a name', () => {
    const state = run(1);
    expect(stepStates(state).map((entry) => entry.name)).toEqual([
      'Планировщик',
      'Кодировщик',
      'Ревьюер',
      'Тестировщик',
    ]);
    (state.run.config.specialists.find((item) => item.slug === 'qa') as { name: string }).name =
      '  ';
    expect(stepStates(state)[3]!.name).toBe('qa');
  });

  it('adds the id to the names that two steps of a pipeline share', () => {
    const state = run(1, {
      configText: `swarm:
  specialists:
    coder: { name: Кодер }
    reviewer: { name: Ревьюер }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
        - { id: review-2, specialist: reviewer }
`,
    });
    expect(stepStates(state).map((entry) => entry.name)).toEqual([
      'Кодер',
      'Ревьюер (review)',
      'Ревьюер (review-2)',
    ]);
  });

  it('keeps a failed group on its step', () => {
    const state = run(1);
    step(state);
    group(state).status = 'failed';
    expect(stepStates(state)[0]?.state).toBe('active');
  });

  it('treats a run without groups as not started', () => {
    const state = run(1);
    state.groups = [];
    expect(stepStates(state).every((entry) => entry.state === 'upcoming')).toBe(true);
  });
});

describe('nextUnskipped and lastUnskipped', () => {
  it('walks over skipped steps', () => {
    const state = run(1);
    state.run.skippedSteps = ['review', 'qa'];
    const group = state.groups[0]!;
    expect(nextUnskipped(state.run, group, 2)).toBeNull();
    expect(nextUnskipped(state.run, group, 1)).toBe(1);
    expect(lastUnskipped(state.run, group)).toBe(1);
    expect(isSkipped(state.run, 'qa')).toBe(true);
  });
});
