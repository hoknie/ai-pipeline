import { describe, expect, it } from 'vitest';

import type { Harness, RunState } from '../../../src/feature/runs/types/index.ts';
import {
  createRun,
  oppositeHarness,
  probeInputOf,
  sameProbeInput,
  stepsOf,
} from '../../../src/feature/runs/types/index.ts';
import { type Effect, transition } from '../../../src/feature/runs/machine/index.ts';
import { applyVariant } from '../../../src/feature/swarm-config/types/index.ts';
import { CONFIG_TEXT, config, finish, run, step } from './helpers.ts';

const SPLIT_CONFIG = CONFIG_TEXT.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

const VARIANT_CONFIG = `swarm:
  max: 5
  specialists:
    plan: { name: Planner }
    coder: { name: Coder, runtime: opencode, model: anthropic/sonnet }
    reviewer: { name: Reviewer, permissions: read }
    qa: { name: Tester }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: qa, specialist: qa }
      variants:
        light:
          skip: [review]
`;

const STEPS = ['plan', 'code', 'review', 'qa'];

/** A pipeline whose variant changes the specialist of a step: a switch edits the step in place. */
const SWITCH_CONFIG = `swarm:
  max: 5
  specialists:
    plan: { name: Planner }
    coder: { name: Coder, runtime: claude, model: sonnet }
    deep: { name: Deep, runtime: opencode, model: anthropic/opus }
    reviewer: { name: Reviewer, permissions: read }
    qa: { name: Tester }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 3 } }
        - { id: qa, specialist: qa }
      variants:
        deep:
          steps:
            code: { specialist: deep }
`;

/** A run that copies the input of the base, as a probe does, with the named harness. */
function probeOf(base: RunState, harness: Harness = 'none'): RunState {
  return createRun({
    id: 'probe0000001',
    number: base.run.number,
    repository: base.run.repository,
    pipeline: base.run.pipeline,
    baseCommit: base.run.baseCommit,
    config: base.run.config,
    configIsResolved: true,
    dirtyWarning: false,
    groups: base.split
      ? [{ title: 'Split', task: base.split.task }]
      : base.groups.map(({ title, task }) => ({ title, task })),
    split: base.split !== null,
    variant: base.run.variant,
    provider: base.run.provider,
    harness,
    probeOf: base.run.id,
    now: 2000,
  });
}

/** A run whose only group is merged, so the next event finishes it and auto delivery may start. */
function merged(options: { probeOf?: string | null } = {}): RunState {
  const state = run(1, options);
  for (const _ of STEPS) {
    step(state);
    finish(state, 'done');
  }
  return state;
}

describe('probe harness', () => {
  it('gives a probe the other harness', () => {
    expect(oppositeHarness('full')).toBe('none');
    expect(oppositeHarness('none')).toBe('full');
  });
});

describe('the input of a probe', () => {
  it('is the same for a copy of the run and ignores the harness', () => {
    const base = run(2);
    const probe = probeOf(base);
    expect(probe.run.harness).toBe('none');
    expect(probe.run.probeOf).toBe(base.run.id);
    expect(sameProbeInput(probeInputOf(base), probeInputOf(probe))).toBe(true);
    expect(sameProbeInput(probeInputOf(probeOf(base, 'full')), probeInputOf(base))).toBe(true);
  });

  it('sees another base commit or task as another input', () => {
    const base = run(2);
    const moved = probeOf(base);
    moved.run.baseCommit = 'def';
    expect(sameProbeInput(probeInputOf(base), probeInputOf(moved))).toBe(false);

    const retasked = probeOf(base);
    retasked.groups[0]!.task = 'another task';
    expect(sameProbeInput(probeInputOf(base), probeInputOf(retasked))).toBe(false);
  });

  it('keeps the split task of a run that splits it', () => {
    const base = run(1, { split: true, configText: SPLIT_CONFIG });
    expect(base.split).not.toBeNull();
    const probe = probeOf(base);
    expect(probe.split).not.toBeNull();
    expect(sameProbeInput(probeInputOf(base), probeInputOf(probe))).toBe(true);
  });
});

describe('a probe of a run with a variant that skips a step', () => {
  function stepIds(state: RunState): string[] {
    return stepsOf(state.run, state.groups[0]!).map((step) => step.id);
  }

  it('copies the configuration a run started with instead of applying the skip again', () => {
    const base = run(1, { configText: VARIANT_CONFIG, variant: 'light' });
    expect(stepIds(base)).toEqual(['plan', 'code', 'qa']);
    const probe = probeOf(base);
    expect(sameProbeInput(probeInputOf(base), probeInputOf(probe))).toBe(true);
    expect(stepIds(probe)).toEqual(stepIds(base));
  });

  it('copies the configuration of a run switched to such a variant, which keeps its steps', () => {
    const base = run(1, { configText: VARIANT_CONFIG });
    transition(
      base,
      {
        kind: 'variant_set',
        variant: 'light',
        config: applyVariant(config(VARIANT_CONFIG), 'feature', 'light'),
      },
      3000,
    );
    expect(base.run.variant).toBe('light');
    expect(stepIds(base)).toEqual(STEPS);
    const probe = probeOf(base);
    expect(sameProbeInput(probeInputOf(base), probeInputOf(probe))).toBe(true);
    expect(stepIds(probe)).toEqual(STEPS);
  });
});

describe('the configuration of a probe', () => {
  function codeSpecialist(state: RunState): string | undefined {
    return stepsOf(state.run, state.groups[0]!).find((step) => step.id === 'code')?.specialist;
  }

  function switchTo(state: RunState, variant: string): void {
    transition(
      state,
      {
        kind: 'variant_set',
        variant,
        config: applyVariant(config(SWITCH_CONFIG), 'feature', variant),
      },
      3000,
    );
  }

  it('is its own copy: a variant switch of the probe leaves the base as it is', () => {
    const base = run(1, { configText: SWITCH_CONFIG });
    const probe = probeOf(base);
    expect(probe.run.config).not.toBe(base.run.config);

    switchTo(probe, 'deep');

    expect(probe.run.variant).toBe('deep');
    expect(codeSpecialist(probe)).toBe('deep');
    expect(base.run.variant).toBe('default');
    expect(codeSpecialist(base)).toBe('coder');
  });

  it('is its own copy: a variant switch of the base leaves the probe as it is', () => {
    const base = run(1, { configText: SWITCH_CONFIG });
    const probe = probeOf(base);

    switchTo(base, 'deep');

    expect(base.run.variant).toBe('deep');
    expect(codeSpecialist(base)).toBe('deep');
    expect(probe.run.variant).toBe('default');
    expect(codeSpecialist(probe)).toBe('coder');
    expect(sameProbeInput(probeInputOf(base), probeInputOf(probe))).toBe(false);
  });
});

describe('auto delivery of a probe', () => {
  it('delivers a main run and leaves a probe for an explicit apply', () => {
    const main = merged();
    const mainEffects: Effect[] = transition(
      main,
      { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
    expect(main.run.finishedAt).toBe(5000);
    expect(main.run.pendingDelivery).not.toBeNull();
    expect(mainEffects.some((effect) => effect.kind === 'deliver')).toBe(true);

    const probe = merged({ probeOf: 'main000000001' });
    const probeEffects = transition(
      probe,
      { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
    expect(probe.run.finishedAt).toBe(5000);
    expect(probeEffects.some((effect) => effect.kind === 'deliver')).toBe(false);
    expect(probe.run.pendingDelivery).toBeNull();
    expect(probe.groups[0]?.delivery.state).toBe('pending');
  });
});
