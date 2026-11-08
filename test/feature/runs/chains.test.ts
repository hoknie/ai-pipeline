import { describe, expect, it } from 'vitest';

import {
  type Attempt,
  type RunState,
  limitHolds,
  selectAttemptRuntime,
} from '../../../src/feature/runs/types/index.ts';
import { dispatch, planDispatch, transition } from '../../../src/feature/runs/machine/index.ts';
import { group, run, runningAttempt } from './helpers.ts';

const CHAIN_CONFIG = `swarm:
  max: 5
  chains:
    fallback:
      name: Fallback Chain
      mode: on_error
      runtimes:
        - runtime: claude
          model: sonnet
        - runtime: opencode
          model: openai/gpt-5
          variant: fast
          reasoning_effort: high
        - runtime: agy
          enabled: false
    cycle:
      name: Cycle Chain
      mode: round_robin
      runtimes:
        - runtime: claude
          model: haiku
        - runtime: opencode
          model: openai/gpt-4o
        - runtime: agy
    disabled-chain:
      name: Disabled
      mode: on_error
      enabled: false
      runtimes:
        - runtime: opencode
  specialists:
    worker:
      name: Исполнитель
      runtime_chain: fallback
    cycler:
      name: Круговой
      runtime_chain: cycle
    fallback-spec:
      name: Отключенный
      runtime_chain: disabled-chain
  pipelines:
    feature:
      steps:
        - { id: work, specialist: worker }
    cycle-pipe:
      steps:
        - { id: step1, specialist: cycler }
        - { id: step2, specialist: cycler }
        - { id: step3, specialist: cycler }
        - { id: step4, specialist: cycler }
    disabled-pipe:
      steps:
        - { id: work, specialist: fallback-spec }
`;

describe('selectAttemptRuntime', () => {
  it('falls back to defaults.runtime with model null if chain is disabled', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    const spec = state.run.config.specialists.find((s) => s.slug === 'fallback-spec')!;
    const selected = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts: [],
      stepIndex: 0,
      round: 1,
      resume: false,
    });
    expect(selected).toEqual({
      runtime: state.run.config.defaults.runtime,
      model: null,
    });
  });

  it('preserves runtime, model, variant, and chainIndex on resume', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    const spec = state.run.config.specialists.find((s) => s.slug === 'worker')!;
    const previousAttempt: Attempt = {
      seq: 1,
      stepId: 'work',
      stepIndex: 0,
      round: 1,
      specialist: 'worker',
      runtime: 'opencode',
      model: 'openai/gpt-5',
      variant: 'fast',
      reasoningEffort: 'high',
      chainIndex: 1,
      status: 'finished',
      input: {
        prompt: 'test',
        groupTitle: 'g1',
        stepId: 'work',
        specialistName: 'Исполнитель',
        skills: [],
        previous: [],
        feedback: null,
        humanAnswer: null,
        decisions: [],
      },
      resumeSession: null,
      sessionId: 'sess-1',
      report: null,
      reason: null,
      startedAt: 1000,
      finishedAt: 2000,
      usage: null,
      proposal: null,
      denials: [],
      outsideChanges: [],
    };
    const selected = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts: [previousAttempt],
      stepIndex: 0,
      round: 1,
      resume: true,
    });
    expect(selected).toEqual({
      runtime: 'opencode',
      model: 'openai/gpt-5',
      variant: 'fast',
      reasoningEffort: 'high',
      chainIndex: 1,
    });
  });

  it('cycles through enabled runtimes in round_robin mode', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    const spec = state.run.config.specialists.find((s) => s.slug === 'cycler')!;
    const attempts: Attempt[] = [];

    const makeAttempt = (
      seq: number,
      runtime: 'claude' | 'opencode' | 'agy',
      index: number,
    ): Attempt => ({
      seq,
      stepId: `step${seq}`,
      stepIndex: seq - 1,
      round: 1,
      specialist: 'cycler',
      runtime,
      model: null,
      chainIndex: index,
      status: 'finished',
      input: {
        prompt: 'test',
        groupTitle: 'g1',
        stepId: 's',
        specialistName: 'Круговой',
        skills: [],
        previous: [],
        feedback: null,
        humanAnswer: null,
        decisions: [],
      },
      resumeSession: null,
      sessionId: null,
      report: null,
      reason: null,
      startedAt: 1000,
      finishedAt: 2000,
      usage: null,
      proposal: null,
      denials: [],
      outsideChanges: [],
    });

    const first = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts,
      stepIndex: 0,
      round: 1,
      resume: false,
    });
    expect(first.runtime).toBe('claude');
    expect(first.chainIndex).toBe(0);
    attempts.push(makeAttempt(1, 'claude', 0));

    const second = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts,
      stepIndex: 1,
      round: 1,
      resume: false,
    });
    expect(second.runtime).toBe('opencode');
    expect(second.chainIndex).toBe(1);
    attempts.push(makeAttempt(2, 'opencode', 1));

    const third = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts,
      stepIndex: 2,
      round: 1,
      resume: false,
    });
    expect(third.runtime).toBe('agy');
    expect(third.chainIndex).toBe(2);
    attempts.push(makeAttempt(3, 'agy', 2));

    const fourth = selectAttemptRuntime({
      specialist: spec,
      chains: state.run.config.chains,
      defaults: state.run.config.defaults,
      limitHolds: new Map(),
      attempts,
      stepIndex: 3,
      round: 1,
      resume: false,
    });
    expect(fourth.runtime).toBe('claude');
    expect(fourth.chainIndex).toBe(0);
  });
});

describe('execution with on_error runtime chains', () => {
  it('does not hold group when first runtime has limit but second runtime is available', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    const holds = new Map<string, number>([['claude', 50_000]]);
    const plan = planDispatch([state], 1000);
    expect(plan.start).toHaveLength(1);
    expect(plan.waits.size).toBe(0);
  });

  it('fails over immediately to second runtime in chain on usage_limit', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    // Dispatch starts 1st attempt on claude
    const effects = dispatch([state], 1000);
    expect(effects).toContainEqual({
      kind: 'start_attempt',
      run: state.run.id,
      group: 'gruppa-1',
      seq: 1,
    });
    const g = group(state);
    expect(g.attempts[0]?.runtime).toBe('claude');
    expect(g.attempts[0]?.chainIndex).toBe(0);

    // Attempt 1 fails with usage_limit
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: {
          sessionId: 'sess-1',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 60_000 },
          outsideChanges: [],
        },
      },
      2000,
    );

    // Group should be queued on the same step and round with resume: false
    expect(g.status).toBe('queued');
    expect(g.pending).toEqual({
      stepIndex: 0,
      feedback: null,
      humanAnswer: null,
      resume: false,
    });

    // Next dispatch starts attempt 2 on opencode
    const nextEffects = dispatch([state], 2100);
    expect(nextEffects).toContainEqual({
      kind: 'start_attempt',
      run: state.run.id,
      group: 'gruppa-1',
      seq: 2,
    });
    expect(g.attempts[1]?.runtime).toBe('opencode');
    expect(g.attempts[1]?.model).toBe('openai/gpt-5');
    expect(g.attempts[1]?.variant).toBe('fast');
    expect(g.attempts[1]?.reasoningEffort).toBe('high');
    expect(g.attempts[1]?.chainIndex).toBe(1);
  });

  it('fails over on runtime_not_found or spawn error', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    dispatch([state], 1000);

    // Attempt 1 fails because claude CLI is not found
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: {
          sessionId: null,
          usage: null,
          failure: { kind: 'runtime_not_found', runtime: 'claude' },
          outsideChanges: [],
        },
      },
      2000,
    );

    const g = group(state);
    expect(g.status).toBe('queued');

    // Next dispatch selects opencode (agy is disabled)
    dispatch([state], 2100);
    expect(g.attempts[1]?.runtime).toBe('opencode');
  });

  it('fails group when all enabled elements have failed', () => {
    const state = run(1, { configText: CHAIN_CONFIG });
    dispatch([state], 1000);

    // 1st attempt (claude) fails
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 1,
        exit: {
          sessionId: null,
          usage: null,
          failure: { kind: 'no_report' },
          outsideChanges: [],
        },
      },
      2000,
    );

    // 2nd attempt (opencode) starts
    dispatch([state], 2100);
    const g = group(state);
    expect(g.attempts[1]?.runtime).toBe('opencode');

    // 2nd attempt (opencode) also fails without report
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: 2,
        exit: {
          sessionId: null,
          usage: null,
          failure: { kind: 'spawn', message: 'exec error' },
          outsideChanges: [],
        },
      },
      3000,
    );

    // All enabled elements exhausted (agy has enabled: false), group is failed
    expect(g.status).toBe('failed');
    expect(g.reason).toBe('spawn error: exec error');
    expect(g.attempts[1]?.reason).toEqual({ kind: 'spawn', message: 'exec error' });
  });
});
