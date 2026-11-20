import { describe, expect, it } from 'vitest';

import {
  type RunState,
  hasNextChainItem,
  selectAttemptRuntime,
} from '../../../src/feature/runs/types/index.ts';
import {
  dispatch,
  planDispatch,
  transition,
  waitKey,
} from '../../../src/feature/runs/machine/index.ts';
import { providerProblem } from '../../../src/feature/swarm-config/types/index.ts';
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
        - { provider: anthropic, runtime: claude, model: haiku, default: true }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-mini }
    off:
      name: Off
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3, enabled: false }
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { runtime: claude, model: opus }
        - { runtime: opencode, model: zai/glm-5.3 }
  specialists:
    thinker: { name: Thinker, runtime_chain: thinking }
    light: { name: Light, runtime_chain: lite }
    sleeper: { name: Sleeper, runtime_chain: off }
    plain: { name: Plain, runtime: opencode, model: openai/gpt-5 }
    failover: { name: Failover, runtime_chain: fallback }
  pipelines:
    deep:
      steps:
        - { id: work, specialist: thinker }
    light:
      steps:
        - { id: work, specialist: light }
    sleeper:
      steps:
        - { id: work, specialist: sleeper }
    plain:
      steps:
        - { id: work, specialist: plain }
    failover:
      steps:
        - { id: work, specialist: failover }
`;

function select(state: RunState, slug: string, provider: string | null, extra = {}) {
  const specialist = state.run.config.specialists.find((s) => s.slug === slug)!;
  return selectAttemptRuntime({
    specialist,
    chains: state.run.config.chains,
    defaults: state.run.config.defaults,
    limitHolds: new Map(),
    attempts: [],
    stepIndex: 0,
    round: 1,
    resume: false,
    provider,
    ...extra,
  });
}

function exit(state: RunState, failure: object, now = 2000): void {
  const attempt = runningAttempt(state);
  transition(
    state,
    {
      kind: 'attempt_exited',
      group: 'group-1',
      seq: attempt.seq,
      exit: { sessionId: 's', usage: null, failure, outsideChanges: [] } as never,
    },
    now,
  );
}

describe('providerProblem', () => {
  const config = run(1, { configText: TIERS, pipeline: 'deep' }).run.config;

  it('accepts a provider of any item, disabled ones included', () => {
    expect(providerProblem(config, 'zai')).toBeNull();
    expect(providerProblem(config, 'anthropic')).toBeNull();
  });

  it('names the known providers of an unknown one', () => {
    expect(providerProblem(config, 'nope')).toBe(
      'unknown provider `nope`; known: anthropic (Anthropic), openai (OpenAI), zai (Z.ai)',
    );
  });

  it('says none when the registry is empty', () => {
    expect(providerProblem({ providers: [] }, 'zai')).toBe('unknown provider `zai`; known: none');
  });

  it('refuses a disabled provider', () => {
    const disabled = {
      providers: config.providers.map((provider) =>
        provider.slug === 'zai' ? { ...provider, enabled: false } : provider,
      ),
    };
    expect(providerProblem(disabled, 'zai')).toBe('provider `zai` is disabled');
    expect(providerProblem(disabled, 'openai')).toBeNull();
  });
});

describe('the strict choice of a tier item', () => {
  it('takes the item of the provider of the run', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    expect(select(state, 'thinker', 'zai')).toEqual({
      runtime: 'opencode',
      model: 'zai/glm-5.3',
      provider: 'zai',
      chainIndex: 1,
    });
  });

  it('takes the default item with the requested provider when the tier has none', () => {
    const state = run(1, { configText: TIERS, pipeline: 'light' });
    expect(select(state, 'light', 'zai')).toMatchObject({
      provider: 'anthropic',
      chainIndex: 0,
      requestedProvider: 'zai',
    });
  });

  it('takes the default item when the item of the provider is disabled', () => {
    const state = run(1, { configText: TIERS, pipeline: 'sleeper' });
    expect(select(state, 'sleeper', 'zai')).toMatchObject({
      provider: 'anthropic',
      requestedProvider: 'zai',
    });
  });

  it('leaves a run without a provider to the usual order', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    const chosen = select(state, 'thinker', null);
    expect(chosen).toMatchObject({ provider: 'anthropic' });
    expect(chosen).not.toHaveProperty('requestedProvider');
  });

  it('does not move to another provider when the chosen one is held', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    const chosen = select(state, 'thinker', 'zai', { limitHolds: new Map([['provider:zai', 9]]) });
    expect(chosen).toMatchObject({ provider: 'zai' });
  });

  it('keeps the item of a continued session and of a network retry', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep', provider: 'zai' });
    dispatch([state], 1000);
    const [first] = group(state).attempts;
    const keep = { attempts: [first!], resume: true };
    expect(select(state, 'thinker', 'openai', keep)).toMatchObject({ provider: 'zai' });
    expect(
      select(state, 'thinker', 'openai', { ...keep, resume: false, keepRuntime: true }),
    ).toMatchObject({
      provider: 'zai',
    });
  });

  it('works only on by_provider chains', () => {
    const state = run(1, { configText: TIERS, pipeline: 'failover' });
    const chosen = select(state, 'failover', 'zai');
    expect(chosen).toMatchObject({ runtime: 'claude', chainIndex: 0 });
    expect(chosen).not.toHaveProperty('requestedProvider');
  });

  it('does not touch a specialist with an explicit runtime and model', () => {
    const state = run(1, { configText: TIERS, pipeline: 'plain' });
    expect(select(state, 'plain', 'zai')).toEqual({ runtime: 'opencode', model: 'openai/gpt-5' });
  });
});

describe('hasNextChainItem with a provider', () => {
  const chain = run(1, { configText: TIERS, pipeline: 'deep' }).run.config.chains.find(
    (c) => c.slug === 'thinking',
  );

  it('finds another item without a provider and none with one', () => {
    expect(hasNextChainItem(chain, [], 0, new Map())).toBe(true);
    expect(hasNextChainItem(chain, [], 0, new Map(), 'zai')).toBe(false);
  });

  it('still lets a chain of another mode switch', () => {
    const fallback = run(1, { configText: TIERS, pipeline: 'deep' }).run.config.chains.find(
      (c) => c.slug === 'fallback',
    );
    expect(hasNextChainItem(fallback, [], 0, new Map(), 'zai')).toBe(true);
  });
});

describe('a run with a provider in the scheduler', () => {
  it('starts the first attempt on the item of the provider', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep', provider: 'openai' });
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({ provider: 'openai', runtime: 'opencode' });
    expect(group(state).attempts[0]).not.toHaveProperty('requestedProvider');
  });

  it('records the requested provider of an attempt on the default item', () => {
    const state = run(1, { configText: TIERS, pipeline: 'light', provider: 'zai' });
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({
      provider: 'anthropic',
      requestedProvider: 'zai',
    });
  });

  it('waits for the reset of the provider while other providers are free', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep', provider: 'zai' });
    dispatch([state], 1000);
    exit(state, { kind: 'usage_limit', resetsAt: 60_000 });
    expect(group(state).status).toBe('queued');
    expect(group(state).pending?.resume).toBe(true);
    const plan = planDispatch([state], 3000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'group-1'))).toEqual({
      reason: 'limit',
      runtime: 'opencode',
      provider: 'zai',
      providerName: 'Z.ai',
      until: 60_000,
    });
    dispatch([state], 60_000);
    expect(group(state).attempts[1]).toMatchObject({ provider: 'zai' });
  });

  it('does not switch provider after a failure without a report', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep', provider: 'zai' });
    dispatch([state], 1000);
    exit(state, { kind: 'no_report' });
    expect(group(state).status).toBe('failed');
  });

  it('gives a step with an explicit model no provider and no mark', () => {
    const state = run(1, { configText: TIERS, pipeline: 'plain', provider: 'zai' });
    dispatch([state], 1000);
    const [attempt] = group(state).attempts;
    expect(attempt).toMatchObject({ runtime: 'opencode', model: 'openai/gpt-5' });
    expect(attempt).not.toHaveProperty('provider');
    expect(attempt).not.toHaveProperty('requestedProvider');
  });

  it('keeps an old run without a provider on the usual order', () => {
    const state = run(1, { configText: TIERS, pipeline: 'deep' });
    expect(state.run.provider).toBeNull();
    dispatch([state], 1000);
    expect(group(state).attempts[0]).toMatchObject({ provider: 'anthropic' });
  });
});
