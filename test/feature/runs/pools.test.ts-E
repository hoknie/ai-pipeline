import { describe, expect, it } from 'vitest';

import {
  type DispatchLimit,
  type RunState,
  attemptSeed,
  poolOf,
  selectAttemptRuntime,
  selectorMatches,
} from '../../../src/feature/runs/types/index.ts';
import { dispatch, planDispatch, waitKey } from '../../../src/feature/runs/machine/index.ts';
import { OFF_NETWORK } from '../../../src/feature/network/types/index.ts';

import { finish, run } from './helpers.ts';

interface Agent {
  id: string;
  runtime: 'claude' | 'opencode' | 'agy';
  model?: string;
  repository?: string;
  max?: number;
  groups?: number;
}

/** One group of a run whose only step is done by a worker on the given runtime and model. */
function agentRun(agent: Agent, index: number): RunState {
  const model = agent.model ? `, model: ${agent.model}` : '';
  const state = run(agent.groups ?? 1, {
    id: agent.id,
    now: 1000 + index,
    ...(agent.max !== undefined ? { max: agent.max } : {}),
    configText: `swarm:
  max: 5
  specialists:
    worker: { name: Worker, runtime: ${agent.runtime}${model} }
  pipelines:
    feature:
      steps:
        - { id: work, specialist: worker }
`,
  });
  state.run.repository = agent.repository ?? '/repo';
  return state;
}

const POOLS = [
  { name: 'claude', max: 2, members: ['claude'] },
  { name: 'mix', max: 2, members: ['opencode:google/*', 'opencode:openai/*'] },
  { name: 'glm', max: 1, members: ['opencode:zai/*'] },
];

function limit(max: number, options: Partial<DispatchLimit> = {}): DispatchLimit {
  return { kind: 'machine', max, pools: POOLS, defaultPool: { max: 1 }, ...options };
}

const names = (plan: ReturnType<typeof planDispatch>) =>
  plan.start.map((entry) => entry.state.run.id);

const AGENTS: Agent[] = [
  { id: 'c1', runtime: 'claude', model: 'sonnet' },
  { id: 'c2', runtime: 'claude', model: 'haiku' },
  { id: 'c3', runtime: 'claude', model: 'sonnet' },
  { id: 'g1', runtime: 'opencode', model: 'google/gemini-2' },
  { id: 'p1', runtime: 'opencode', model: 'openai/gpt-5' },
  { id: 'p2', runtime: 'opencode', model: 'openai/gpt-5' },
  { id: 'z1', runtime: 'opencode', model: 'zai/glm-5' },
  { id: 'z2', runtime: 'opencode', model: 'zai/glm-5' },
  { id: 'd1', runtime: 'opencode' },
];

describe('selectors of a pool', () => {
  it('match a runtime, a model and a prefix of a model with their case', () => {
    expect(selectorMatches('claude', 'claude', 'sonnet')).toBe(true);
    expect(selectorMatches('claude', 'opencode', null)).toBe(false);
    expect(selectorMatches('agy', 'agy', null)).toBe(true);
    expect(selectorMatches('opencode', 'opencode', null)).toBe(true);
    expect(selectorMatches('opencode', 'opencode', 'google/gemini-2')).toBe(false);
    expect(selectorMatches('opencode:google/*', 'opencode', 'google/gemini-2')).toBe(true);
    expect(selectorMatches('opencode:google/*', 'opencode', 'Google/gemini-2')).toBe(false);
    expect(selectorMatches('opencode:google/*', 'opencode', null)).toBe(false);
    expect(selectorMatches('opencode:google/gemini-2', 'opencode', 'google/gemini-2')).toBe(true);
    expect(selectorMatches('opencode:google/gemini-2', 'opencode', 'google/gemini-3')).toBe(false);
    expect(selectorMatches('opencode:google/*', 'claude', 'google/gemini-2')).toBe(false);
  });

  it('give a pool, the default pool for the rest, and nothing without pools', () => {
    const config = { pools: POOLS, defaultPool: { max: 1 } };
    expect(poolOf(config, 'claude', 'sonnet')).toMatchObject({ name: 'claude', max: 2 });
    expect(poolOf(config, 'opencode', 'google/gemini-2')).toMatchObject({ name: 'mix' });
    expect(poolOf(config, 'opencode', 'openai/gpt-5')).toMatchObject({ name: 'mix' });
    expect(poolOf(config, 'opencode', 'zai/glm-5')).toMatchObject({ name: 'glm' });
    expect(poolOf(config, 'opencode', null)).toMatchObject({ name: 'default', max: 1 });
    expect(poolOf(config, 'agy', null)).toMatchObject({ name: 'default' });
    expect(poolOf({ pools: [], defaultPool: null }, 'claude', null)).toBeNull();
  });

  it('give a stable seed to an attempt and a different one to the next', () => {
    expect(attemptSeed('r', 'g', 's', 1)).toBe(attemptSeed('r', 'g', 's', 1));
    expect(attemptSeed('r', 'g', 's', 1)).not.toBe(attemptSeed('r', 'g', 's', 2));
  });
});

describe('planDispatch with pools', () => {
  it('runs five attempts split 2/2/1 and holds the rest by the pool or the machine', () => {
    const states = AGENTS.map(agentRun);
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(5));
    expect(names(plan)).toEqual(['c1', 'c2', 'g1', 'p1', 'z1']);
    expect(plan.waits.get(waitKey('c3', 'group-1'))).toEqual({
      reason: 'pool',
      pool: 'claude',
      max: 2,
    });
    expect(plan.waits.get(waitKey('p2', 'group-1'))).toEqual({
      reason: 'pool',
      pool: 'mix',
      max: 2,
    });
    expect(plan.waits.get(waitKey('z2', 'group-1'))).toEqual({
      reason: 'pool',
      pool: 'glm',
      max: 1,
    });
    // The default pool has a free place, the machine has none.
    expect(plan.waits.get(waitKey('d1', 'group-1'))).toEqual({
      reason: 'capacity',
      scope: 'machine',
      max: 5,
    });
  });

  it('lends no place of an idle pool to a full one', () => {
    const states = AGENTS.filter((agent) => agent.runtime === 'claude').map(agentRun);
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(5));
    expect(names(plan)).toEqual(['c1', 'c2']);
    expect(plan.waits.get(waitKey('c3', 'group-1'))).toMatchObject({ reason: 'pool' });
  });

  it('skips the group a full pool holds and starts the next one of a free pool', () => {
    const states = ['c1', 'c2', 'c3', 'z1'].map((id) =>
      agentRun(
        AGENTS.find((a) => a.id === id)!,
        0,
      ),
    );
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(5));
    expect(names(plan)).toEqual(['c1', 'c2', 'z1']);
  });

  it('counts the attempts that already run, of every project, against the pool', () => {
    const states = ['g1', 'p1', 'p2'].map((id, index) =>
      agentRun({ ...AGENTS.find((a) => a.id === id)!, repository: `/project-${index}` }, index),
    );
    dispatch(states.slice(0, 2), 2000, OFF_NETWORK, limit(5));
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(5));
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey('p2', 'group-1'))).toMatchObject({
      reason: 'pool',
      pool: 'mix',
    });
  });

  it('puts a group without an explicit OpenCode model into the default pool', () => {
    const states = ['d1', 'd1'].map((id, index) =>
      agentRun({ ...AGENTS.find((a) => a.id === id)!, id: `d${index}` }, index),
    );
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(5));
    expect(names(plan)).toEqual(['d0']);
    expect(plan.waits.get(waitKey('d1', 'group-1'))).toEqual({
      reason: 'pool',
      pool: 'default',
      max: 1,
    });
  });

  it('sets no quota without pools but keeps the machine limit', () => {
    const states = AGENTS.map(agentRun);
    const plan = planDispatch(
      states,
      3000,
      OFF_NETWORK,
      limit(5, { pools: [], defaultPool: null }),
    );
    expect(plan.start).toHaveLength(5);
    expect(plan.waits.get(waitKey('z2', 'group-1'))).toMatchObject({ reason: 'capacity' });
  });

  it('lets a shell command start although the pool and the machine are full', () => {
    const state = run(1, {
      id: 'shell',
      now: 900,
      split: true,
      configText: `swarm:
  max: 5
  specialists:
    worker: { name: Worker, runtime: claude }
  actions:
    lint: { run: "a" }
  stages:
    before_split: [lint]
  pipelines:
    feature:
      split: { specialist: worker, max_groups: 3 }
      steps:
        - { id: work, specialist: worker }
`,
    });
    const full = ['c1', 'c2'].map((id, index) =>
      agentRun(
        AGENTS.find((a) => a.id === id)!,
        index,
      ),
    );
    dispatch(full, 2000, OFF_NETWORK, limit(2));
    const plan = planDispatch([...full, state], 3000, OFF_NETWORK, limit(2));
    expect(plan.start.map((entry) => entry.group.slug)).toEqual(['_action-before-split-lint']);
    dispatch([...full, state], 3100, OFF_NETWORK, limit(2));
    const next = agentRun(
      AGENTS.find((a) => a.id === 'z1')!,
      5,
    );
    // The running command takes no place: only the two agents count.
    expect(planDispatch([...full, state, next], 3200, OFF_NETWORK, limit(3)).start).toHaveLength(1);
  });

  it('keeps running attempts when a quota drops and holds new ones until places free up', () => {
    const states = ['c1', 'c2'].map((id, index) =>
      agentRun(
        AGENTS.find((a) => a.id === id)!,
        index,
      ),
    );
    dispatch(states, 2000, OFF_NETWORK, limit(5));
    const next = agentRun(
      AGENTS.find((a) => a.id === 'c3')!,
      5,
    );
    const smaller = limit(5, {
      pools: [{ name: 'claude', max: 1, members: ['claude'] }],
    });
    const plan = planDispatch([...states, next], 3000, OFF_NETWORK, smaller);
    expect(states.every((state) => state.groups[0]!.status === 'running')).toBe(true);
    expect(plan.start).toEqual([]);
    finish(states[0]!, 'done', { slug: 'group-1' });
    expect(planDispatch([...states, next], 3100, OFF_NETWORK, smaller).start).toEqual([]);
    finish(states[1]!, 'done', { slug: 'group-1' });
    expect(names(planDispatch([...states, next], 3200, OFF_NETWORK, smaller))).toEqual(['c3']);
  });
});

describe('the chosen runtime of a waiting attempt', () => {
  const CHAIN = `swarm:
  max: 5
  chains:
    mixed:
      name: Mixed
      mode: random
      runtimes:
        - { runtime: opencode, model: google/gemini-2 }
        - { runtime: claude, model: sonnet }
  specialists:
    worker: { name: Worker, runtime_chain: mixed }
  pipelines:
    feature:
      steps:
        - { id: work, specialist: worker }
`;

  function chained(): RunState {
    return run(1, { configText: CHAIN });
  }

  it('starts on the runtime and model the plan counted', () => {
    const state = chained();
    const [entry] = planDispatch([state], 1500, OFF_NETWORK, limit(5)).start;
    dispatch([state], 1500, OFF_NETWORK, limit(5));
    const attempt = state.groups[0]!.attempts[0]!;
    expect(attempt.runtime).toBe(entry!.selected!.runtime);
    expect(attempt.model).toBe(entry!.selected!.model);
  });

  it('does not change with the time of a repeated plan, so a full pool is not bypassed', () => {
    const state = chained();
    const choices = new Set<string>();
    for (const now of [1500, 1501, 9000, 123_456]) {
      const wait = planDispatch([state], now, OFF_NETWORK, limit(5)).start[0]!.selected!;
      choices.add(`${wait.runtime}/${wait.model}`);
    }
    expect(choices.size).toBe(1);
    // The pool the attempt waits for is full: it waits for that pool at any time.
    const chosen = [...choices][0]!;
    const full = chosen.startsWith('claude')
      ? { name: 'claude', max: 1, members: ['claude'] }
      : { name: 'mix', max: 1, members: ['opencode:google/*'] };
    const filler = chosen.startsWith('claude')
      ? agentRun({ id: 'f1', runtime: 'claude', model: 'sonnet' }, 0)
      : agentRun({ id: 'f1', runtime: 'opencode', model: 'google/gemini-2' }, 0);
    dispatch([filler], 1200, OFF_NETWORK, limit(5, { pools: [full] }));
    for (const now of [1500, 9000, 123_456]) {
      const plan = planDispatch([filler, state], now, OFF_NETWORK, limit(5, { pools: [full] }));
      expect(plan.start).toEqual([]);
      expect(plan.waits.get(waitKey(state.run.id, 'group-1'))).toMatchObject({
        reason: 'pool',
        pool: full.name,
      });
    }
  });

  it('keeps the runtime and model of the previous attempt when it resumes, whatever the chain', () => {
    const state = chained();
    dispatch([state], 1500);
    const first = state.groups[0]!.attempts[0]!;
    const specialist = state.run.config.specialists.find((s) => s.slug === 'worker')!;
    const options = {
      specialist,
      defaults: state.run.config.defaults,
      limitHolds: new Map<string, number>(),
      attempts: [first],
      stepIndex: 0,
      round: 2,
      resume: true,
    };
    const expected = { runtime: first.runtime, model: first.model };
    const off = state.run.config.chains.map((chain) => ({ ...chain, enabled: false }));
    const empty = state.run.config.chains.map((chain) => ({
      ...chain,
      runtimes: chain.runtimes.map((item) => ({ ...item, enabled: false })),
    }));
    const missing: typeof off = [];
    for (const chains of [off, empty, missing]) {
      expect(selectAttemptRuntime({ ...options, chains })).toMatchObject(expected);
      expect(
        selectAttemptRuntime({ ...options, chains, resume: false, keepRuntime: true }),
      ).toMatchObject(expected);
    }
    // Without a previous attempt the defaults apply.
    expect(selectAttemptRuntime({ ...options, chains: off, attempts: [] })).toEqual({
      runtime: state.run.config.defaults.runtime,
      model: null,
    });
  });
});

describe('the order of the reasons to wait', () => {
  const network = { state: 'down', problem: 'no route', checkedAt: 0 } as never;

  it('shows the network before a full pool and the machine limit', () => {
    const states = ['c1', 'c2', 'c3'].map((id, index) =>
      agentRun(
        AGENTS.find((a) => a.id === id)!,
        index,
      ),
    );
    dispatch(states.slice(0, 2), 2000, OFF_NETWORK, limit(5));
    const plan = planDispatch(states, 3000, network, limit(2));
    expect(plan.waits.get(waitKey('c3', 'group-1'))).toMatchObject({ reason: 'network' });
  });

  it('shows the specialist before the pool, and the pool before the machine', () => {
    const limited = (id: string, index: number) => {
      const state = agentRun(
        AGENTS.find((a) => a.id === id)!,
        index,
      );
      state.run.config.specialists.find((s) => s.slug === 'worker')!.max = 1;
      return state;
    };
    const states = ['c1', 'c2', 'c3'].map(limited);
    dispatch(states.slice(0, 1), 2000, OFF_NETWORK, limit(1));
    const plan = planDispatch(states, 3000, OFF_NETWORK, limit(1));
    expect(plan.waits.get(waitKey('c2', 'group-1'))).toMatchObject({ reason: 'specialist' });
    const unlimited = ['c1', 'c2', 'c3'].map((id, index) =>
      agentRun(
        AGENTS.find((a) => a.id === id)!,
        index,
      ),
    );
    dispatch(unlimited.slice(0, 2), 2000, OFF_NETWORK, limit(2));
    // The pool of Claude and the machine are both full: the pool is named.
    expect(
      planDispatch(unlimited, 3000, OFF_NETWORK, limit(2)).waits.get(waitKey('c3', 'group-1')),
    ).toEqual({ reason: 'pool', pool: 'claude', max: 2 });
  });
});
