import { describe, expect, it } from 'vitest';

import { applySkip, checkSkip, cleanSkip, stepsOf } from '../../src/core/index.ts';
import { findWorkflow } from '../../src/config/index.ts';

import { CONFIG_TEXT, config, run } from './helpers.ts';

const EPIC_CONFIG = `${CONFIG_TEXT.trimEnd()}
    explore:
      steps:
        - { id: look, specialist: plan }
        - { id: check, specialist: reviewer, on_reject: { goto: look, max_rounds: 2 } }
    epic:
      split: { specialist: plan, max_groups: 3, workflow: explore }
`;

function ids(text: string, workflow: string, skip: string[]): string[] {
  const resolved = applySkip(config(text), workflow, skip);
  const found = findWorkflow(resolved, workflow)!;
  return (found.split?.workflow ? findWorkflow(resolved, found.split.workflow)! : found).steps.map(
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

  it('refuses an unknown workflow', () => {
    expect(checkSkip(resolved, 'nope', ['qa'])).toBe('unknown workflow `nope`');
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
    expect(findWorkflow(resolved, 'feature')!.steps).toHaveLength(4);
  });

  it('cuts the steps of split.workflow', () => {
    expect(ids(EPIC_CONFIG, 'epic', ['check'])).toEqual(['look']);
    expect(() => applySkip(config(EPIC_CONFIG), 'epic', ['plan'])).toThrow(/unknown step `plan`/);
  });

  it('is applied by createRun to the snapshot', () => {
    const state = run(1, { skip: ['review', 'qa'] });
    expect(stepsOf(state.run, state.groups[0]!).map((step) => step.id)).toEqual(['plan', 'code']);
    expect(() => run(1, { skip: ['deploy'] })).toThrow(/unknown step/);
  });
});
