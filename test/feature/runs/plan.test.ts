import { describe, expect, it } from 'vitest';

import {
  dispatch,
  planDispatch,
  transition,
  waitKey,
} from '../../../src/feature/runs/machine/index.ts';
import {
  type DispatchLimit,
  type RunState,
  REPOSITORY_LIMIT,
  newGroup,
} from '../../../src/feature/runs/types/index.ts';

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

/** The run with its `swarm.max` replaced; 0 fills every slot. */
function withMax(state: RunState, max: number): RunState {
  state.run.config.max = max;
  return state;
}

describe('planDispatch', () => {
  it('starts what dispatch starts and leaves the state untouched', () => {
    const state = planned(3);
    const before = structuredClone(state);
    const plan = planDispatch([state], 1500);
    expect(state).toEqual(before);
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    const effects = dispatch([state], 1500);
    expect(effects.map((effect) => (effect.kind === 'start_attempt' ? effect.group : ''))).toEqual([
      'gruppa-1',
    ]);
  });

  it('makes groups wait for a busy specialist in the same run', () => {
    const state = planned(3);
    const plan = planDispatch([state], 1500);
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
    const plan = planDispatch([first, second], 1500);
    expect(plan.start.map((entry) => entry.state.run.id)).toEqual(['run000000001']);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-1'))).toMatchObject({
      reason: 'specialist',
    });
  });

  it('reports capacity when swarm.max is taken', () => {
    const state = run(3, { max: 2 });
    const plan = planDispatch([state], 1500);
    expect(plan.start).toHaveLength(2);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-3'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 2,
    });
  });

  it('counts swarm.max separately for each repository', () => {
    const first = run(2, { id: 'run000000001', max: 1 });
    const second = run(2, { id: 'run000000002', now: 2000, max: 1 });
    second.run.repository = '/other';
    const plan = planDispatch([first, second], 1500);
    expect(plan.start.map((entry) => `${entry.state.run.id}/${entry.group.slug}`)).toEqual([
      'run000000001/gruppa-1',
      'run000000002/gruppa-1',
    ]);
    expect(plan.waits.get(waitKey('run000000001', 'gruppa-2'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 1,
    });
  });

  it('takes swarm.max of a repository from its most recently created run', () => {
    const older = run(3, { id: 'run000000001', max: 1 });
    const newer = run(1, { id: 'run000000002', now: 2000, max: 3 });
    const elsewhere = run(1, { id: 'run000000003', now: 3000, max: 1 });
    elsewhere.run.repository = '/other';
    const plan = planDispatch([older, newer, elsewhere], 3500);
    expect(plan.start.map((entry) => `${entry.state.run.id}/${entry.group.slug}`)).toEqual([
      'run000000001/gruppa-1',
      'run000000001/gruppa-2',
      'run000000001/gruppa-3',
      'run000000003/gruppa-1',
    ]);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-1'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 3,
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
    const plan = planDispatch([state], 3000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-1'))).toEqual({
      reason: 'limit',
      runtime: 'opencode',
      until: 50_000,
    });
  });

  it('names the specialist, not the capacity, when both hold a group back', () => {
    const state = withMax(planned(2), 1);
    const plan = planDispatch([state], 1500);
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-2'))).toMatchObject({
      reason: 'specialist',
    });
  });

  it('does not put a group with a free specialist into waits', () => {
    const state = run(2);
    const plan = planDispatch([state], 1500);
    expect(plan.start).toHaveLength(2);
    expect(plan.waits.size).toBe(0);
  });

  it('plans the system steps like groups', () => {
    const state: RunState = run(1, { split: true, configText: SPLIT });
    const full = planDispatch([withMax(state, 0)], 1500);
    expect(full.waits.get(waitKey(state.run.id, '_split'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 0,
    });
    expect(planDispatch([withMax(state, 5)], 1500).start.map((entry) => entry.group.slug)).toEqual([
      '_split',
    ]);
  });

  it('ignores a finished run', () => {
    const state = run(1);
    state.run.finishedAt = 1200;
    const plan = planDispatch([state], 1500);
    expect(plan.start).toEqual([]);
    expect(plan.waits.size).toBe(0);
  });

  it('does not wait for a step whose specialist is not in the configuration', () => {
    const state = run(1);
    state.run.config.specialists = state.run.config.specialists.filter(
      (specialist) => specialist.slug !== 'plan',
    );
    const plan = planDispatch([state], 1500);
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
    const plan = planDispatch([withMax(state, 0)], 3000);
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
    const full = planDispatch([withMax(state, 0)], 1500);
    expect(full.waits.get(waitKey(state.run.id, slug))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 0,
    });
    expect(
      planDispatch([withMax(state, 5)], 1500).start.map((entry) => entry.group.slug),
    ).toContain(slug);
  });
});

describe('a run with a hold', () => {
  it('starts nothing, fills no waits and starts again after the hold is lifted', () => {
    const state = planned(1, { id: 'a' });
    transition(state, { kind: 'hold', hold: 'paused' }, 3000);
    const held = planDispatch([state], 3001);
    expect(held.start).toEqual([]);
    expect(held.waits.size).toBe(0);
    transition(state, { kind: 'hold', hold: null }, 3002);
    const lifted = planDispatch([state], 3003);
    expect(lifted.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
    expect(lifted.start[0]!.group.pending?.stepIndex).toBe(1);
  });

  it('lets a running attempt of the held run finish', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'hold', hold: 'paused' }, 3000);
    expect(runningAttempt(state).status).toBe('running');
    finish(state, 'done');
    expect(dispatch([state], 3500)).toEqual([]);
    expect(state.groups[0]!.pending?.stepIndex).toBe(1);
  });
});

describe('planDispatch with a limit of the machine', () => {
  const machine = (max: number): DispatchLimit => ({
    kind: 'machine',
    max,
    pools: [],
    defaultPool: null,
  });

  function twoProjects() {
    const app = run(2, { id: 'run000000001', max: 1 });
    const lib = run(2, { id: 'run000000002', now: 2000, max: 1 });
    lib.run.repository = '/other';
    return { app, lib };
  }

  const started = (plan: ReturnType<typeof planDispatch>) =>
    plan.start.map((entry) => `${entry.state.run.id}/${entry.group.slug}`);

  it('counts the working specialists of every repository together', () => {
    const { app, lib } = twoProjects();
    const plan = planDispatch([app, lib], 3000, undefined, machine(3));
    expect(started(plan)).toEqual([
      'run000000001/gruppa-1',
      'run000000001/gruppa-2',
      'run000000002/gruppa-1',
    ]);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-2'))).toEqual({
      reason: 'capacity',
      scope: 'machine',
      max: 3,
    });
  });

  it('ignores swarm.max of the runs', () => {
    const { app, lib } = twoProjects();
    withMax(app, 0);
    withMax(lib, 0);
    expect(planDispatch([app, lib], 3000, undefined, machine(4)).start).toHaveLength(4);
    expect(planDispatch([app, lib], 3000).start).toHaveLength(0);
  });

  it('keeps the max of a specialist in both modes', () => {
    const app = planned(2, { id: 'run000000001' });
    const repository = planDispatch([app], 3000, undefined, REPOSITORY_LIMIT);
    const global = planDispatch([app], 3000, undefined, machine(5));
    for (const plan of [repository, global]) {
      expect(plan.start.map((entry) => entry.group.slug)).toEqual(['gruppa-1']);
      expect(plan.waits.get(waitKey('run000000001', 'gruppa-2'))).toMatchObject({
        reason: 'specialist',
      });
    }
  });

  it('leaves the mode of the projects as it was', () => {
    const { app, lib } = twoProjects();
    const plan = planDispatch([app, lib], 3000, undefined, REPOSITORY_LIMIT);
    expect(started(plan)).toEqual(['run000000001/gruppa-1', 'run000000002/gruppa-1']);
  });

  it('lets the older run take the places of the machine first', () => {
    const { app, lib } = twoProjects();
    const plan = planDispatch([lib, app], 3000, undefined, machine(1));
    expect(started(plan)).toEqual(['run000000001/gruppa-1']);
  });
});

describe('planDispatch with the machine limit in the project mode', () => {
  const project = (max: number): DispatchLimit => ({
    kind: 'repository',
    max,
    pools: [],
    defaultPool: null,
  });

  const started = (plan: ReturnType<typeof planDispatch>) =>
    plan.start.map((entry) => `${entry.state.run.id}/${entry.group.slug}`);

  function projects(options: { a: number; b: number; aMax?: number; bMax?: number }) {
    const a = run(options.a, { id: 'run000000001', max: options.aMax ?? 5 });
    const b = run(options.b, { id: 'run000000002', now: 2000, max: options.bMax ?? 5 });
    b.run.repository = '/other';
    return { a, b };
  }

  it('limits the agents of the machine although swarm.max has room', () => {
    const { a, b } = projects({ a: 3, b: 2, aMax: 4, bMax: 4 });
    const plan = planDispatch([a, b], 3000, undefined, project(3));
    expect(started(plan)).toEqual([
      'run000000001/gruppa-1',
      'run000000001/gruppa-2',
      'run000000001/gruppa-3',
    ]);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-1'))).toEqual({
      reason: 'capacity',
      scope: 'machine',
      max: 3,
    });
  });

  it('names swarm.max when only the repository is full, and lets another project start', () => {
    const { a, b } = projects({ a: 1, b: 3, bMax: 2 });
    const plan = planDispatch([a, b], 3000, undefined, project(5));
    expect(started(plan)).toEqual([
      'run000000001/gruppa-1',
      'run000000002/gruppa-1',
      'run000000002/gruppa-2',
    ]);
    expect(plan.waits.get(waitKey('run000000002', 'gruppa-3'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 2,
    });
    const more = run(1, { id: 'run000000003', now: 3000, max: 5 });
    more.run.repository = '/third';
    expect(started(planDispatch([a, b, more], 3000, undefined, project(5)))).toContain(
      'run000000003/gruppa-1',
    );
  });

  it('shows the machine limit first when both are full and the repository one afterwards', () => {
    const { a, b } = projects({ a: 1, b: 3, bMax: 2 });
    dispatch([a, b], 3000, undefined, project(3));
    const both = planDispatch([a, b], 3100, undefined, project(3));
    expect(both.waits.get(waitKey('run000000002', 'gruppa-3'))).toEqual({
      reason: 'capacity',
      scope: 'machine',
      max: 3,
    });
    // The agent of the other project ends; the place of the machine is free, the repository is not.
    finish(a, 'done', { slug: 'gruppa-1', now: 3200 });
    transition(a, { kind: 'hold', hold: 'paused' }, 3300);
    const after = planDispatch([a, b], 3400, undefined, project(3));
    expect(after.start).toEqual([]);
    expect(after.waits.get(waitKey('run000000002', 'gruppa-3'))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 2,
    });
  });

  it('keeps running agents when the limit drops and waits for the number to fall', () => {
    const { a, b } = projects({ a: 2, b: 1 });
    dispatch([a, b], 3000, undefined, project(5));
    const next = run(1, { id: 'run000000003', now: 3000, max: 5 });
    expect(planDispatch([a, b, next], 3100, undefined, project(1)).start).toEqual([]);
    expect(a.groups.map((group) => group.status)).toEqual(['running', 'running']);
    expect(
      planDispatch([a, b, next], 3100, undefined, project(1)).waits.get(
        waitKey('run000000003', 'gruppa-1'),
      ),
    ).toEqual({ reason: 'capacity', scope: 'machine', max: 1 });
  });

  it('counts a direct run like any run of its repository', () => {
    const { a, b } = projects({ a: 1, b: 1, aMax: 1 });
    const direct = run(1, { id: 'run000000003', now: 3000, max: 1 });
    const plan = planDispatch([a, b, direct], 3000, undefined, project(5));
    expect(plan.waits.get(waitKey('run000000003', 'gruppa-1'))).toMatchObject({
      scope: 'repository',
    });
  });
});
