import { describe, expect, it } from 'vitest';

import {
  dispatch,
  newGroup,
  planDispatch,
  transition,
  waitKey,
  type RunState,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, run, runningAttempt, step } from './helpers.ts';

const LIMITED = CONFIG_TEXT.replace(
  'coder: { name: Кодировщик,',
  'coder: { name: Кодировщик, max: 1,',
);

/** Groups of the run go through `plan` and wait for `code`. */
function planned(groups: number, options: { id?: string; now?: number; max?: number } = {}) {
  const state = run(groups, { configText: LIMITED, ...options });
  step(state);
  for (let index = 1; index <= groups; index++) finish(state, 'done', { slug: `gruppa-${index}` });
  return state;
}

const SPLIT = CONFIG_TEXT.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
);

describe('planDispatch', () => {
  it('starts what dispatch starts and leaves the state untouched', () => {
    const state = planned(3);
    const before = structuredClone(state);
    const plan = planDispatch([state], 5, 1500);
    expect(state).toEqual(before);
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    const effects = dispatch([state], 5, 1500);
    expect(effects.map((effect) => (effect.kind === 'start_attempt' ? effect.group : ''))).toEqual([
      'gruppa-1',
    ]);
  });

  it('makes groups wait for a busy specialist in the same run', () => {
    const state = planned(3);
    const plan = planDispatch([state], 5, 1500);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-2'))).toEqual({
      reason: 'specialist',
      specialist: 'coder',
      name: 'Кодировщик',
      max: 1,
    });
    expect(plan.waits.has(waitKey(state.run.id, 'gruppa-1'))).toBe(false);
  });

  it('makes a group wait for a specialist busy in another run', () => {
    const first = planned(1, { id: 'run000000001' });
    const second = planned(1, { id: 'run000000002', now: 2000 });
    const plan = planDispatch([first, second], 5, 1500);
    expect(plan.start.map((entry) => entry.state.run.id)).toEqual(['run000000001']);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-1'))).toMatchObject({
      reason: 'specialist',
    });
  });

  it('reports capacity when swarm.max is taken', () => {
    const state = run(3);
    const plan = planDispatch([state], 2, 1500);
    expect(plan.start).toHaveLength(2);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-3'))).toEqual({
      reason: 'capacity',
      max: 2,
    });
  });

  it('reports the usage limit of the runtime with the reset time', () => {
    const state = planned(1);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 50_000 },
          outsideChanges: [],
        },
      },
      2000,
    );
    const plan = planDispatch([state], 5, 3000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-1'))).toEqual({
      reason: 'limit',
      runtime: 'opencode',
      until: 50_000,
    });
  });

  it('names the specialist, not the capacity, when both hold a group back', () => {
    const state = planned(2);
    const plan = planDispatch([state], 1, 1500);
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-2'))).toMatchObject({
      reason: 'specialist',
    });
  });

  it('does not put a group with a free specialist into waits', () => {
    const state = run(2);
    const plan = planDispatch([state], 5, 1500);
    expect(plan.start).toHaveLength(2);
    expect(plan.waits.size).toBe(0);
  });

  it('plans the system steps like groups', () => {
    const state: RunState = run(1, { split: true, configText: SPLIT });
    const full = planDispatch([state], 0, 1500);
    expect(full.waits.get(waitKey(state.run.id, '_split'))).toEqual({ reason: 'capacity', max: 0 });
    expect(planDispatch([state], 5, 1500).start.map((entry) => entry.group.slug)).toEqual([
      '_split',
    ]);
  });

  it('ignores a finished run', () => {
    const state = run(1);
    state.run.finishedAt = 1200;
    const plan = planDispatch([state], 5, 1500);
    expect(plan.start).toEqual([]);
    expect(plan.waits.size).toBe(0);
  });

  it('does not wait for a step whose specialist is not in the configuration', () => {
    const state = run(1);
    state.run.config.specialists = state.run.config.specialists.filter(
      (specialist) => specialist.slug !== 'plan',
    );
    const plan = planDispatch([state], 0, 1500);
    expect(plan.waits.size).toBe(0);
  });
  it('lets the usage limit win over a busy specialist and a full swarm.max', () => {
    const state = planned(2);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 50_000 },
          outsideChanges: [],
        },
      },
      2000,
    );
    const plan = planDispatch([state], 0, 3000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-2'))).toMatchObject({ reason: 'limit' });
  });

  it.each([
    ['_message', 'message'],
    ['_resolve', 'resolve'],
  ] as const)('plans the system step %s like a group', (slug, field) => {
    const state: RunState = run(1);
    if (field === 'message') state.run.config.delivery.messageSpecialist = 'coder';
    else state.run.config.delivery.resolver = 'coder';
    state[field] = newGroup(slug, slug, 'task', 1_000_000);
    const full = planDispatch([state], 0, 1500);
    expect(full.waits.get(waitKey(state.run.id, slug))).toEqual({ reason: 'capacity', max: 0 });
    expect(planDispatch([state], 5, 1500).start.map((entry) => entry.group.slug)).toContain(slug);
  });
});

describe('a run with a hold', () => {
  it('starts nothing, fills no waits and starts again after the hold is lifted', () => {
    const state = planned(1, { id: 'a' });
    transition(state, { kind: 'hold', hold: 'paused' }, 3000);
    const held = planDispatch([state], 5, 3001);
    expect(held.start).toEqual([]);
    expect(held.waits.size).toBe(0);
    transition(state, { kind: 'hold', hold: null }, 3002);
    const lifted = planDispatch([state], 5, 3003);
    expect(lifted.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    expect(lifted.start[0]!.group.pending?.stepIndex).toBe(1);
  });

  it('lets a running attempt of the held run finish', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'hold', hold: 'paused' }, 3000);
    expect(runningAttempt(state).status).toBe('running');
    finish(state, 'done');
    expect(dispatch([state], 5, 3500)).toEqual([]);
    expect(state.groups[0]!.pending?.stepIndex).toBe(1);
  });
});
