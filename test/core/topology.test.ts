import { describe, expect, it } from 'vitest';

import {
  topology,
  transition,
  workflowTopologies,
  workflowTopology,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, config, finish, run, step } from './helpers.ts';

describe('topology of a run with skipped steps', () => {
  it('lists only the remaining steps', () => {
    const view = topology(run(1, { skip: ['review', 'qa'] }));
    expect(view.steps.map((entry) => entry.id)).toEqual(['plan', 'code']);
  });
});

describe('topology', () => {
  it('places groups on steps and sums attempts, rejections and usage per step', () => {
    const state = run(2);
    for (const _ of ['plan', 'code']) {
      step(state);
      finish(state, 'done');
      finish(state, 'done', { slug: 'gruppa-2' });
    }
    step(state);
    finish(state, 'rejected', { feedback: 'нет тестов' });
    finish(state, 'done', { slug: 'gruppa-2' });
    step(state);
    state.groups[0]!.attempts.at(-1)!.usage = { inputTokens: 10, outputTokens: 2, costUsd: 0.5 };
    const view = topology(state);
    expect(view.steps.map((entry) => entry.id)).toEqual(['plan', 'code', 'review', 'qa']);
    const [plan, code, review, qa] = view.steps;
    expect(code).toMatchObject({
      specialist: 'coder',
      name: 'Кодировщик',
      runtime: 'opencode',
      model: 'anthropic/sonnet',
      attempts: 3,
      groups: [{ slug: 'gruppa-1', status: 'running' }],
      usage: { costUsd: 0.5 },
    });
    expect(review).toMatchObject({
      attempts: 2,
      rejections: 1,
      onReject: { goto: 'code', maxRounds: 3 },
      permissions: 'read',
      groups: [],
    });
    expect(qa?.groups).toEqual([{ slug: 'gruppa-2', title: 'Группа 2', status: 'running' }]);
    expect(plan?.groups).toEqual([]);
    expect(view.split).toBeNull();
    expect(view.delivery).toMatchObject({ mode: 'worktree', resolver: null });
  });

  it('moves finished groups to the merge and delivery nodes', () => {
    const state = run(1);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    expect(topology(state).merging).toEqual([
      { slug: 'gruppa-1', title: 'Группа 1', status: 'merging' },
    ]);
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
    const view = topology(state);
    expect(view.merging).toEqual([]);
    expect(view.merged.map((group) => group.slug)).toEqual(['gruppa-1']);
    expect(view.steps.every((entry) => entry.groups.length === 0)).toBe(true);
  });
});

describe('workflow topology', () => {
  it('describes every workflow of a configuration without runs', () => {
    const all = workflowTopologies(config());
    expect(all.map((workflow) => workflow.id)).toEqual(['feature']);
    expect(all[0]?.steps[2]).toEqual({
      id: 'review',
      specialist: 'reviewer',
      name: 'Ревьюер',
      runtime: 'claude',
      model: null,
      permissions: 'read',
      onReject: { goto: 'code', maxRounds: 3 },
    });
    expect(all[0]).toMatchObject({ split: null, delivery: { mode: 'worktree', resolver: null } });
    expect(workflowTopology(config(), 'missing')).toBeNull();
  });

  it('gives the limit of the specialists of the split, the steps and the resolver', () => {
    const text = `${CONFIG_TEXT}  delivery: { resolver: qa }\n`
      .replace('plan: { name: Планировщик,', 'plan: { name: Планировщик, max: 2,')
      .replace('coder: { name: Кодировщик,', 'coder: { name: Кодировщик, max: 1,')
      .replace(
        '    feature:\n      steps:',
        '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
      );
    expect(workflowTopology(config(text), 'feature')?.limits).toEqual({
      plan: 2,
      coder: 1,
      reviewer: null,
      qa: null,
    });
    expect(workflowTopology(config(), 'feature')?.limits).toEqual({
      plan: null,
      coder: null,
      reviewer: null,
      qa: null,
    });
  });
});

describe('topology of a workflow that splits into another', () => {
  const text = `${CONFIG_TEXT}    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder }
`.replace(
    /    feature:\n      steps:\n(        - .*\n){4}/,
    '    feature:\n      split: { specialist: plan, workflow: explore }\n',
  );

  it('shows the steps of the target and the link', () => {
    const view = workflowTopology(config(text), 'feature');
    expect(view?.split).toEqual({ specialist: 'plan', maxGroups: 5, workflow: 'explore' });
    expect(view?.steps.map((entry) => entry.id)).toEqual(['research', 'write']);
  });

  it('places the groups of a run on the steps of the target', () => {
    const state = run(1, { configText: text });
    step(state);
    const view = topology(state);
    expect(view.split?.workflow).toBe('explore');
    expect(view.steps[0]).toMatchObject({ id: 'research', groups: [{ slug: 'gruppa-1' }] });
  });
});
