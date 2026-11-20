import { describe, expect, it } from 'vitest';

import {
  type RunState,
  heldUntil,
  holdKey,
  holdOf,
  limitHolds,
  hasNextChainItem,
  selectAttemptRuntime,
} from '../../../src/feature/runs/types/index.ts';
import {
  dispatch,
  planDispatch,
  transition,
  waitKey,
} from '../../../src/feature/runs/machine/index.ts';
import { group, run, runningAttempt } from './helpers.ts';

const TIERS = `swarm:
  max: 5
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
    openai: { name: OpenAI, access: [{ kind: cli, runtime: opencode, model_prefix: openai }] }
  chains:
    thinking:
      name: Thinking
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-sol }
    lite:
      name: Lite
      mode: by_provider
      runtimes:
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-sol, default: true }
  specialists:
    thinker:
      name: Thinker
      runtime_chain: thinking
    light:
      name: Light
      runtime_chain: lite
    plain:
      name: Plain
      runtime: opencode
  pipelines:
    deep:
      steps:
        - { id: work, specialist: thinker }
    light:
      steps:
        - { id: work, specialist: light }
    plain:
      steps:
        - { id: work, specialist: plain }
`;

function select(state: RunState, slug: string, holds = new Map<string, number>()) {
  const specialist = state.run.config.specialists.find((s) => s.slug === slug)!;
  return selectAttemptRuntime({
    specialist,
    chains: state.run.config.chains,
    defaults: state.run.config.defaults,
    limitHolds: holds,
    attempts: [],
    stepIndex: 0,
    round: 1,
    resume: false,
  });
}

function limit(state: RunState, resetsAt: number, now = 2000): void {
  const attempt = runningAttempt(state);
  transition(
    state,
    {
      kind: 'attempt_exited',
      group: 'group-1',
      seq: attempt.seq,
      exit: {
        sessionId: 's',
        usage: null,
        failure: { kind: 'usage_limit', resetsAt },
        outsideChanges: [],
      },
    },
    now,
  );
}

describe('a by_provider chain without a requested provider', () => {
  it('starts on the first item and carries its provider', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    expect(select(state, 'thinker')).toEqual({
      runtime: 'claude',
      model: 'opus',
      provider: 'anthropic',
      chainIndex: 0,
    });
  });

  it('ignores default when no provider is requested', () => {
    const state = run(1, { configText: TIERS, pipeline: 'light' });
    expect(select(state, 'light')).toMatchObject({ provider: 'zai', chainIndex: 0 });
  });

  it('goes to the next item right after a usage limit, like on_error', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({ provider: 'anthropic', chainIndex: 0 });
    limit(state, 60_000);
    expect(group(state).status).toBe('queued');
    expect(group(state).pending?.resume).toBe(false);
    dispatch([state], 2100);
    expect(group(state).attempts[1]).toMatchObject({
      runtime: 'opencode',
      provider: 'zai',
      chainIndex: 1,
    });
  });

  it('goes to the next item after a failure without a report', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    dispatch([state], 1000);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'group-1',
        seq: attempt.seq,
        exit: { sessionId: null, usage: null, failure: { kind: 'no_report' }, outsideChanges: [] },
      },
      2000,
    );
    dispatch([state], 2100);
    expect(group(state).attempts[1]).toMatchObject({ provider: 'zai', chainIndex: 1 });
  });

  it('hasNextChainItem counts a by_provider chain', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    const chain = state.run.config.chains.find((c) => c.slug === 'thinking');
    expect(hasNextChainItem(chain, [], 0, new Map())).toBe(true);
    const all = new Map([
      ['claude', 9],
      ['provider:zai', 9],
      ['provider:openai', 9],
    ]);
    expect(hasNextChainItem(chain, [], 0, all)).toBe(false);
  });

  it('skips an item whose provider is held', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    const holds = new Map([['provider:anthropic', 9]]);
    expect(select(state, 'thinker', holds)).toMatchObject({ provider: 'zai', chainIndex: 1 });
  });
});

describe('the hold key of a limit', () => {
  it('is the provider when there is one, else the runtime', () => {
    expect(holdKey('opencode', 'zai')).toBe('provider:zai');
    expect(holdKey('opencode')).toBe('opencode');
    expect(holdKey('opencode', null)).toBe('opencode');
  });

  it('covers an item by its provider key or by its runtime key', () => {
    const holds = new Map([
      ['provider:zai', 30],
      ['opencode', 20],
    ]);
    expect(heldUntil(holds, 'opencode', 'zai')).toBe(30);
    expect(heldUntil(holds, 'opencode', 'openai')).toBe(20);
    expect(heldUntil(holds, 'opencode')).toBe(20);
    expect(holdOf(holds, 'opencode', 'zai')).toEqual({ until: 30, provider: 'zai' });
    expect(holdOf(holds, 'opencode', 'openai')).toEqual({ until: 20 });
    expect(heldUntil(holds, 'claude', 'zai')).toBe(30);
    expect(heldUntil(new Map([['provider:zai', 30]]), 'opencode', 'openai')).toBeUndefined();
  });

  it('keeps the limit of an attempt under its provider', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    dispatch([state], 1000);
    limit(state, 60_000);
    expect(limitHolds([state], 3000)).toEqual(new Map([['provider:anthropic', 60_000]]));
  });
});

describe('the limit of one provider in the dispatch plan', () => {
  /** A run whose only attempt is a limit on `zai`; a second run is ready for `item`. */
  function twoRuns(pipeline: string) {
    const limited = run(1, { id: 'run000000001', configText: TIERS, pipeline: 'light' });
    dispatch([limited], 1000);
    limit(limited, 60_000);
    // The limited run found a free item after the limit; keep its group out of the way.
    limited.groups[0]!.status = 'merged';
    limited.groups[0]!.pending = null;
    const other = run(1, { id: 'run000000002', configText: TIERS, pipeline, now: 1100 });
    return { limited, other };
  }

  it('does not hold an item of another provider on the same runtime', () => {
    const { limited, other } = twoRuns('light');
    // `light` starts on zai, which is held: it falls to openai, and `other` does the same.
    const plan = planDispatch([limited, other], 3000);
    expect(plan.waits.size).toBe(0);
    expect(plan.start.map((entry) => entry.selected?.provider)).toEqual(['openai']);
  });

  it('holds an item of the same provider and names it in the wait', () => {
    const state = run(1, { configText: TIERS, pipeline: 'light' });
    state.run.config.chains = state.run.config.chains.map((chain) =>
      chain.slug === 'lite' ? { ...chain, runtimes: [chain.runtimes[0]!] } : chain,
    );
    dispatch([state], 1000);
    limit(state, 60_000);
    const plan = planDispatch([state], 3000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'group-1'))).toEqual({
      reason: 'limit',
      runtime: 'opencode',
      provider: 'zai',
      providerName: 'Z.ai',
      until: 60_000,
    });
    expect(planDispatch([state], 60_000).start).toHaveLength(1);
  });

  it('holds the runtime, without a provider, after a limit of a specialist without a chain', () => {
    const state = run(1, { configText: TIERS, pipeline: 'plain' });
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({ runtime: 'opencode' });
    limit(state, 60_000);
    const holds = limitHolds([state], 3000);
    expect(holds).toEqual(new Map([['opencode', 60_000]]));
    // The hold covers every provider of the runtime.
    expect(heldUntil(holds, 'opencode', 'zai')).toBe(60_000);
    expect(heldUntil(holds, 'opencode', 'openai')).toBe(60_000);
    const plan = planDispatch([state], 3000);
    expect(plan.start).toEqual([]);
    const wait = plan.waits.get(waitKey(state.run.id, 'group-1'));
    expect(wait).toEqual({ reason: 'limit', runtime: 'opencode', until: 60_000 });
    expect(wait).not.toHaveProperty('provider');
  });
});
