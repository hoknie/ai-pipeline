import { describe, expect, it } from 'vitest';

import { transition } from '../../../src/feature/runs/machine/index.ts';
import { type RunState, describeFailReason } from '../../../src/feature/runs/types/index.ts';

import { group, run, step } from './helpers.ts';

const TEXT = `swarm:
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
    other:
      name: Other
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: haiku, default: true }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-mini }
  specialists:
    thinker: { name: Thinker, runtime_chain: thinking }
    light: { name: Light, runtime_chain: lite }
    reviewer: { name: Reviewer, runtime: claude, model: sonnet, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: thinker }
        - { id: review, specialist: reviewer }
        - { id: qa, specialist: light }
`;

function switchTo(state: RunState, provider: string | null) {
  return transition(state, { kind: 'provider_set', provider }, 3000);
}

/** A run whose first attempt (step `step`) is running. */
function running(provider: string | null, skip: string[] = ['review', 'qa']): RunState {
  const state = run(1, {
    configText: TEXT,
    skip,
    ...(provider === null ? {} : { provider }),
  });
  step(state);
  return state;
}

describe('switching the provider of a run', () => {
  it('stops the running step whose item changes and starts it again on the new item', () => {
    const state = running('zai');
    const first = group(state).attempts[0]!;
    expect(first).toMatchObject({ stepId: 'code', provider: 'zai', chainIndex: 1 });
    first.sessionId = 'session-1';
    first.input = { ...first.input, feedback: 'fix the tests', humanAnswer: 'use sqlite' };
    const effects = switchTo(state, 'openai');
    expect(effects).toEqual([
      { kind: 'stop_attempt', run: 'run000000001', group: 'group-1', seq: first.seq },
    ]);
    expect(first).toMatchObject({
      status: 'cancelled',
      reason: { kind: 'provider', from: 'zai', to: 'openai' },
    });
    expect(state.run.provider).toBe('openai');
    expect(group(state)).toMatchObject({
      status: 'queued',
      pending: {
        stepIndex: 0,
        feedback: 'fix the tests',
        humanAnswer: 'use sqlite',
        resume: false,
      },
    });
    step(state, 3500);
    const second = group(state).attempts[1]!;
    expect(second).toMatchObject({ stepId: 'code', provider: 'openai', status: 'running' });
    expect(second.resumeSession).toBeNull();
  });

  it('stops a running step of a run without a provider when a provider is chosen', () => {
    const state = running(null);
    const first = group(state).attempts[0]!;
    switchTo(state, 'zai');
    expect(first.reason).toEqual({ kind: 'provider', from: null, to: 'zai' });
  });

  it('lets a step outside the tiers go on', () => {
    const state = running('zai', ['code', 'qa']);
    const first = group(state).attempts[0]!;
    expect(first.stepId).toBe('review');
    expect(switchTo(state, 'openai')).toEqual([]);
    expect(first.status).toBe('running');
    expect(state.run.provider).toBe('openai');
  });

  it('refuses a provider with no item in the chain of the running step', () => {
    const state = running('zai');
    const first = group(state).attempts[0]!;
    expect(first).toMatchObject({ stepId: 'code', provider: 'zai' });
    expect(() => switchTo(state, 'deepseek')).toThrow(
      'cannot switch run run000000001 to provider `deepseek`: chain `thinking` has no enabled item of provider `deepseek`',
    );
    expect(state.run.provider).toBe('zai');
    expect(first.status).toBe('running');
  });

  it('does not stop a running step on a reset', () => {
    const state = running('zai');
    const first = group(state).attempts[0]!;
    expect(switchTo(state, null)).toEqual([]);
    expect(first.status).toBe('running');
    expect(state.run.provider).toBeNull();
  });

  it('does nothing when the run already has the provider', () => {
    const state = running('zai');
    const before = JSON.stringify(state);
    expect(switchTo(state, 'zai')).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('refuses a finished run without groups to retry', () => {
    const state = running('zai');
    state.run.finishedAt = 2000;
    group(state).attempts[0]!.status = 'finished';
    group(state).status = 'merged';
    expect(() => switchTo(state, 'openai')).toThrow('run run000000001 is finished');
    expect(state.run.provider).toBe('zai');
  });

  it('allows a finished run with a failed group', () => {
    const state = running('zai');
    state.run.finishedAt = 2000;
    group(state).attempts[0]!.status = 'failed';
    group(state).status = 'failed';
    switchTo(state, 'openai');
    expect(state.run.provider).toBe('openai');
  });
});

/** A group that waits after its first attempt on `zai`, which no longer runs. */
function waiting(status: 'needs_human' | 'queued', resume = true): RunState {
  const state = running('zai');
  const first = group(state).attempts[0]!;
  first.status = 'cancelled';
  first.sessionId = 'session-1';
  const waits = group(state);
  waits.status = status;
  if (status === 'needs_human') waits.question = 'Which database?';
  waits.pending = { stepIndex: 0, feedback: null, humanAnswer: null, resume };
  return state;
}

describe('a waiting group when the provider changes', () => {
  it('keeps the question and starts the step in a new session', () => {
    const state = waiting('needs_human');
    expect(switchTo(state, 'openai')).toEqual([]);
    expect(group(state)).toMatchObject({
      status: 'needs_human',
      question: 'Which database?',
      pending: { stepIndex: 0, resume: false },
    });
  });

  it('starts a group that waits for a limit in a new session on the new item', () => {
    const state = waiting('queued');
    group(state).pending = { ...group(state).pending!, keepRuntime: true };
    switchTo(state, 'openai');
    expect(group(state).pending).not.toHaveProperty('keepRuntime');
    expect(group(state).pending?.resume).toBe(false);
    step(state, 3500);
    expect(group(state).attempts[1]).toMatchObject({ provider: 'openai', resumeSession: null });
  });

  it('keeps the session when the item is the same', () => {
    const state = waiting('needs_human');
    switchTo(state, 'zai');
    expect(group(state).pending?.resume).toBe(true);
  });

  it('keeps the session of a step outside the tiers', () => {
    const state = run(1, { configText: TEXT, skip: ['code', 'qa'], provider: 'zai' });
    const waits = group(state);
    waits.status = 'needs_human';
    waits.pending = { stepIndex: 1, feedback: null, humanAnswer: null, resume: true };
    switchTo(state, 'openai');
    expect(waits.pending?.resume).toBe(true);
  });
});

describe('the reason of a provider change', () => {
  it('names both providers, none for no provider', () => {
    expect(describeFailReason({ kind: 'provider', from: 'zai', to: 'openai' })).toBe(
      'provider changed: zai → openai',
    );
    expect(describeFailReason({ kind: 'provider', from: null, to: 'openai' })).toBe(
      'provider changed: none → openai',
    );
    expect(describeFailReason({ kind: 'provider', from: 'zai', to: null })).toBe(
      'provider changed: zai → none',
    );
    expect(
      describeFailReason({ kind: 'provider_missing', provider: 'zai', chain: 'thinking' }),
    ).toBe('no enabled item of provider `zai` in chain `thinking`');
  });
});

const CHAIN = `swarm:
  max: 5
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
    openai: { name: OpenAI, access: [{ kind: cli, runtime: opencode, model_prefix: openai }] }
  chains:
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
        - { provider: openai, runtime: opencode, model: openai/gpt-6.1-sol }
  specialists:
    worker: { name: Worker, runtime_chain: fallback }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: worker }
`;

/** A run whose only attempt is running on the `on_error` chain. */
function chained(provider: string | null = null): RunState {
  const state = run(1, {
    configText: CHAIN,
    ...(provider === null ? {} : { provider }),
  });
  step(state);
  return state;
}

describe('switching the provider of an on_error chain', () => {
  it('stops and restarts the running step when the item of the new provider differs', () => {
    const state = chained('zai');
    const first = group(state).attempts[0]!;
    expect(first).toMatchObject({ provider: 'zai', chainIndex: 1 });
    expect(switchTo(state, 'openai')).toEqual([
      { kind: 'stop_attempt', run: 'run000000001', group: 'group-1', seq: first.seq },
    ]);
    expect(first).toMatchObject({
      status: 'cancelled',
      reason: { kind: 'provider', from: 'zai', to: 'openai' },
    });
    step(state, 3500);
    expect(group(state).attempts[1]).toMatchObject({
      provider: 'openai',
      chainIndex: 2,
      resumeSession: null,
    });
  });

  it('lets the running step go on when it already runs on an item of the new provider', () => {
    const state = chained();
    const first = group(state).attempts[0]!;
    expect(first).toMatchObject({ provider: 'anthropic', chainIndex: 0 });
    expect(switchTo(state, 'anthropic')).toEqual([]);
    expect(first.status).toBe('running');
    expect(state.run.provider).toBe('anthropic');
  });

  it('refuses a provider with no item in an on_error chain', () => {
    const state = chained('zai');
    const first = group(state).attempts[0]!;
    expect(() => switchTo(state, 'deepseek')).toThrow(
      'cannot switch run run000000001 to provider `deepseek`: chain `fallback` has no enabled item of provider `deepseek`',
    );
    expect(first.status).toBe('running');
    expect(state.run.provider).toBe('zai');
  });
});
