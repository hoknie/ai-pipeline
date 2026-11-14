import { describe, expect, it } from 'vitest';

import { dispatch, transition } from '../../../src/feature/runs/machine/index.ts';
import {
  findGroup,
  attemptStepLabel,
  stepLabel,
  specialistName,
  stepName,
  topology,
  pipelineTopologies,
  pipelineTopology,
} from '../../../src/feature/runs/types/index.ts';
import { CONFIG_TEXT, config, finish, run, step } from './helpers.ts';

describe('topology of a run with skipped steps', () => {
  it('lists only the remaining steps', () => {
    const view = topology(run(1, { skip: ['review', 'qa'] }));
    expect(view.steps.map((entry) => entry.id)).toEqual(['plan', 'code']);
  });
});

describe('topology skipped flag', () => {
  it('marks steps skipped after the start', () => {
    const state = run(1);
    state.run.skippedSteps = ['qa'];
    expect(topology(state).steps.map((entry) => entry.skipped)).toEqual([
      false,
      false,
      false,
      true,
    ]);
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

describe('pipeline topology', () => {
  it('describes every pipeline of a configuration without runs', () => {
    const all = pipelineTopologies(config());
    expect(all.map((pipeline) => pipeline.id)).toEqual(['feature']);
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
    expect(pipelineTopology(config(), 'missing')).toBeNull();
  });

  it('gives the limit of the specialists of the split, the steps and the resolver', () => {
    const text = `${CONFIG_TEXT}  delivery: { resolver: qa }\n`
      .replace('plan: { name: Планировщик,', 'plan: { name: Планировщик, max: 2,')
      .replace('coder: { name: Кодировщик,', 'coder: { name: Кодировщик, max: 1,')
      .replace(
        '    feature:\n      steps:',
        '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
      );
    expect(pipelineTopology(config(text), 'feature')?.limits).toEqual({
      plan: 2,
      coder: 1,
      reviewer: null,
      qa: null,
    });
    expect(pipelineTopology(config(), 'feature')?.limits).toEqual({
      plan: null,
      coder: null,
      reviewer: null,
      qa: null,
    });
  });
});

describe('topology of a pipeline that splits into another', () => {
  const text = `${CONFIG_TEXT}    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder }
`.replace(
    /    feature:\n      steps:\n(        - .*\n){4}/,
    '    feature:\n      split: { specialist: plan, pipeline: explore }\n',
  );

  it('shows the steps of the target and the link', () => {
    const view = pipelineTopology(config(text), 'feature');
    expect(view?.split).toEqual({
      specialist: 'plan',
      maxGroups: 5,
      pipeline: 'explore',
      pipelineName: 'explore',
    });
    expect(view?.steps.map((entry) => entry.id)).toEqual(['research', 'write']);
  });

  it('places the groups of a run on the steps of the target', () => {
    const state = run(1, { configText: text });
    step(state);
    const view = topology(state);
    expect(view.split?.pipeline).toBe('explore');
    expect(view.steps[0]).toMatchObject({ id: 'research', groups: [{ slug: 'gruppa-1' }] });
  });
});

const TWINS = `swarm:
  specialists:
    coder: { name: Кодер }
    reviewer: { name: Ревьюер }
    mute: { name: Тихий }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
        - { id: review-2, specialist: reviewer }
        - { id: silent, specialist: mute }
`;

function twins() {
  const state = run(1, { configText: TWINS });
  (state.run.config.specialists.find((item) => item.slug === 'mute') as { name: string }).name =
    '  ';
  return state;
}

describe('human names of specialists', () => {
  it('returns the name, and the slug without a name or for an unknown specialist', () => {
    const state = twins();
    const { config } = state.run;
    expect(specialistName(config, 'coder')).toBe('Кодер');
    expect(specialistName(config, 'mute')).toBe('mute');
    expect(specialistName(config, 'nobody')).toBe('nobody');
  });
});

describe('human names of steps', () => {
  it('names a step after its specialist, or by the specialist slug when the name is empty', () => {
    const state = twins();
    const steps = state.run.config.pipelines[0]!.steps;
    expect(stepName(state.run.config, steps[0]!)).toBe('Кодер');
    expect(stepName(state.run.config, steps[3]!)).toBe('mute');
  });

  it('adds the id to a name that another step of the pipeline has', () => {
    const state = twins();
    const steps = state.run.config.pipelines[0]!.steps;
    expect(steps.map((item) => stepLabel(state.run.config, steps, item))).toEqual([
      'Кодер',
      'Ревьюер (review)',
      'Ревьюер (review-2)',
      'mute',
    ]);
    expect(topology(state).steps.map((item) => item.name)).toEqual([
      'Кодер',
      'Ревьюер (review)',
      'Ревьюер (review-2)',
      'mute',
    ]);
  });

  it('names the step of an attempt, falling back to the specialist of the attempt and the id', () => {
    const state = run(1);
    step(state);
    const group = findGroup(state, 'gruppa-1')!;
    const attempt = group.attempts[0]!;
    expect(attemptStepLabel(state, group, attempt)).toBe('Планировщик');
    expect(
      attemptStepLabel(state, group, { ...attempt, stepId: 'gone', specialist: 'coder' }),
    ).toBe('Кодировщик');
    expect(
      attemptStepLabel(state, group, { ...attempt, stepId: 'gone', specialist: 'nobody' }),
    ).toBe('gone');
  });
});

describe('name of a pipeline in the topology', () => {
  const named = `${CONFIG_TEXT.replace('    feature:\n', '    feature:\n      name: Новая функция\n')}    epic:\n      split: { specialist: plan, pipeline: feature }\n`;

  it('carries the name, or the id without one, and the name of the split target', () => {
    const topologies = pipelineTopologies(config(named));
    const feature = topologies.find((entry) => entry.id === 'feature')!;
    expect(feature.name).toBe('Новая функция');
    const epic = topologies.find((entry) => entry.id === 'epic')!;
    expect(epic.name).toBe('epic');
    expect(epic.split?.pipelineName).toBe('Новая функция');
    expect(pipelineTopology(config(), 'feature')?.name).toBe('feature');
  });

  it('takes the name of the split target from the snapshot of the run', () => {
    const state = run(1, { configText: named, split: true });
    state.run.pipeline = 'epic';
    expect(topology(state).split?.pipelineName).toBe('Новая функция');
  });
});

describe('stages in the topology', () => {
  const TEXT = `swarm:
  specialists:
    plan: { name: Планировщик }
    coder: { name: Кодировщик }
    writer: { name: Писатель }
  actions:
    lint: { run: lint }
    commit: { run: commit }
  stages:
    before_delivery: [lint]
    after_delivery: [commit]
  delivery: { message_specialist: writer }
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: code, specialist: coder }
    plain:
      steps:
        - { id: code, specialist: coder }
`;

  it('gives the topology of a pipeline the stages without statuses', () => {
    const shape = pipelineTopology(config(TEXT), 'feature');
    expect(shape?.stages.map((stage) => [stage.id, stage.status, stage.group])).toEqual([
      ['split', null, null],
      ['step:code', null, null],
      ['merge', null, null],
      ['action:before_delivery:lint', null, null],
      ['message', null, null],
      ['delivery', null, null],
      ['action:after_delivery:commit', null, null],
      ['cleanup', null, null],
    ]);
    expect(shape?.steps.map((entry) => entry.id)).toEqual(['code']);
  });

  it('lists the stages of every pipeline', () => {
    const all = pipelineTopologies(config(TEXT));
    expect(all.map((entry) => entry.stages.length)).toEqual([8, 7]);
  });

  it('gives the topology of a run the statuses and the groups of its stages', () => {
    const plain = `${TEXT.slice(0, TEXT.indexOf('  pipelines:'))}  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;
    const state = run(1, { configText: plain });
    const view = topology(state);
    expect(view.stages.map((stage) => stage.id)).toEqual([
      'step:code',
      'merge',
      'action:before_delivery:lint',
      'message',
      'delivery',
      'action:after_delivery:commit',
      'cleanup',
    ]);
    expect(view.stages[0]?.status).toBe('queued');
    expect(view.split).toBeNull();
  });

  it('keeps the old fields of the topology', () => {
    const view = topology(run(1));
    expect(view).toMatchObject({ steps: expect.any(Array), merging: [], merged: [] });
    expect(view.stages.map((stage) => stage.id)).toEqual([
      'step:plan',
      'step:code',
      'step:review',
      'step:qa',
      'merge',
      'delivery',
      'cleanup',
    ]);
  });

  it('gives merge, delivery and cleanup a status from the run', () => {
    const plain = `${TEXT.slice(0, TEXT.indexOf('  pipelines:'))}  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;
    const state = run(1, { configText: plain });
    const status = (id: string) => topology(state).stages.find((stage) => stage.id === id)?.status;
    expect(status('merge')).toBeNull();
    expect(status('delivery')).toBeNull();
    expect(status('cleanup')).toBeNull();
    dispatch([state], 1500);
    finish(state, 'done');
    expect(status('merge')).toBe('merging');
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
    expect(status('merge')).toBe('done');
    // The automatic delivery waits for the check.
    expect(status('delivery')).toBe('waiting');
    expect(status('action:before_delivery:lint')).toBe('queued');
    transition(state, { kind: 'hold', hold: 'paused' }, 3050);
    expect(status('action:before_delivery:lint')).toBe('queued');
    transition(state, { kind: 'hold', hold: null }, 3060);
    dispatch([state], 3100);
    transition(
      state,
      {
        kind: 'action_finished',
        group: '_action-before-delivery-lint',
        seq: 1,
        outcome: { kind: 'exit', code: 0 },
      },
      3200,
    );
    expect(status('delivery')).toBe('running');
    transition(
      state,
      {
        kind: 'delivery_finished',
        result: { kind: 'applied', files: ['a'], conflicts: [], commit: null },
      },
      3300,
    );
    expect(status('delivery')).toBe('done');
    expect(status('cleanup')).toBe('waiting');
    dispatch([state], 3400);
    transition(
      state,
      {
        kind: 'action_finished',
        group: '_action-after-delivery-commit',
        seq: 1,
        outcome: { kind: 'exit', code: 0 },
      },
      3500,
    );
    expect(status('cleanup')).toBe('done');
  });
});

describe('topology of the variants of a pipeline', () => {
  const text = `swarm:
  specialists:
    plan: { name: Plan }
    coder: { name: Coder, runtime: claude, model: sonnet }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
      variants:
        light:
          name: Light
          skip: [review]
        strong:
          steps:
            code: { model: opus }
`;

  it('shows the model of the variant on its step', () => {
    const state = run(1, { configText: text });
    const feature = pipelineTopology(state.run.config, 'feature')!;
    const strong = feature.variants.find((variant) => variant.id === 'strong')!;
    expect(strong.steps.find((entry) => entry.id === 'code')?.model).toBe('opus');
    const base = feature.variants.find((variant) => variant.id === 'default')!;
    expect(base.steps.find((entry) => entry.id === 'code')?.model).toBe('sonnet');
  });

  it('keeps a skipped step in place with the flag', () => {
    const state = run(1, { configText: text });
    const light = pipelineTopology(state.run.config, 'feature')!.variants.find(
      (variant) => variant.id === 'light',
    )!;
    expect(light.steps.map((entry) => [entry.id, entry.skipped])).toEqual([
      ['plan', false],
      ['code', false],
      ['review', true],
    ]);
    expect(light.split).toBeNull();
  });
});
