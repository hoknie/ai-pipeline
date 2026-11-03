// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { busyStep, stepOfGroup } from '../src/components/runs/skipStep.tsx';

import { runView, topologyOf } from './fixtures.ts';

describe('stepOfGroup', () => {
  it('returns the step the group is running on', () => {
    expect(stepOfGroup(runView(), 'login')).toBe('code');
  });

  it('returns the step the group waits for, not the step of its last attempt', () => {
    const base = topologyOf();
    const topology = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'code'
          ? { ...step, groups: [] }
          : step.id === 'review'
            ? { ...step, groups: [{ slug: 'login', title: 'Вход', status: 'queued' as const }] }
            : step,
      ),
    };
    expect(stepOfGroup(runView({ topology }), 'login')).toBe('review');
  });

  it('returns null for a merged group and an unknown one', () => {
    const base = topologyOf();
    const topology = {
      ...base,
      steps: base.steps.map((step) => ({ ...step, groups: [] })),
    };
    expect(stepOfGroup(runView({ topology }), 'login')).toBeNull();
    expect(stepOfGroup(runView(), 'nope')).toBeNull();
  });
});

describe('busyStep', () => {
  it('is true only for a step with a running group', () => {
    expect(busyStep(runView(), 'code')).toBe(true);
    expect(busyStep(runView(), 'review')).toBe(false);
  });
});
