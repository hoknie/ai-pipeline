import { describe, expect, it } from 'vitest';

import { pipelineTopology, topology } from '../../../src/feature/runs/types/index.ts';
import { config, run } from './helpers.ts';

const CHAINS = `swarm:
  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: opencode, model_prefix: zai }] }
  chains:
    failover:
      name: Failover
      mode: on_error
      runtimes:
        - { runtime: claude, model: opus }
        - { runtime: opencode, model: openai/gpt-6, enabled: false }
    tier:
      name: Tier
      mode: by_provider
      runtimes:
        - { provider: anthropic, runtime: claude, model: opus, default: true }
        - { provider: zai, runtime: opencode, model: zai/glm-5.3 }
  specialists:
    plan: { name: Plan }
    coder: { name: Coder, runtime: opencode, model: openai/gpt-6 }
    chained: { name: Chained, runtime_chain: failover }
    tiered: { name: Tiered, runtime_chain: tier }
  pipelines:
    feature:
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: chain, specialist: chained }
        - { id: tier, specialist: tiered }
      variants:
        strong:
          steps:
            code: { model: openai/gpt-5 }
        other:
          steps:
            code: { runtime: claude }
        chained:
          steps:
            code: { runtime_chain: failover }
`;

describe('the launch plan of a fixed step', () => {
  it('does not guess whether the specialist explicitly sets the default runtime', () => {
    const plan = pipelineTopology(config(CHAINS), 'feature')!;
    expect(plan.steps.find((step) => step.id === 'plan')).toMatchObject({
      runtime: 'claude',
      model: null,
      runtimeChain: null,
      runtimeSource: 'unknown',
      modelSource: 'runtime',
      launch: null,
    });
  });

  it('names the specialist when it sets the executor and the model', () => {
    const plan = pipelineTopology(config(CHAINS), 'feature')!;
    expect(plan.steps.find((step) => step.id === 'code')).toMatchObject({
      runtime: 'opencode',
      model: 'openai/gpt-6',
      runtimeChain: null,
      runtimeSource: 'specialist',
      modelSource: 'specialist',
      launch: null,
    });
  });
});

describe('the launch plan of a step on a chain', () => {
  it('shows the chain, its mode and its items as the launch choice', () => {
    const plan = pipelineTopology(config(CHAINS), 'feature')!;
    const step = plan.steps.find((entry) => entry.id === 'chain');
    expect(step).toMatchObject({
      runtime: 'claude',
      model: null,
      runtimeChain: 'failover',
      runtimeSource: 'chain',
      modelSource: 'chain',
    });
    expect(step?.launch).toEqual({
      chain: 'failover',
      name: 'Failover',
      mode: 'on_error',
      active: true,
      candidates: [
        { runtime: 'claude', model: 'opus', enabled: true },
        { runtime: 'opencode', model: 'openai/gpt-6', enabled: false },
      ],
    });
  });

  it('keeps the provider and the default item of a by_provider level', () => {
    const plan = pipelineTopology(config(CHAINS), 'feature')!;
    expect(plan.steps.find((entry) => entry.id === 'tier')?.launch).toEqual({
      chain: 'tier',
      name: 'Tier',
      mode: 'by_provider',
      active: true,
      candidates: [
        { provider: 'anthropic', runtime: 'claude', model: 'opus', default: true, enabled: true },
        { provider: 'zai', runtime: 'opencode', model: 'zai/glm-5.3', enabled: true },
      ],
    });
  });

  it('marks a disabled chain as inactive with the defaults as the fallback', () => {
    const text = CHAINS.replace(
      '      name: Failover',
      '      name: Failover\n      enabled: false',
    );
    const plan = pipelineTopology(config(text), 'feature')!;
    expect(plan.steps.find((entry) => entry.id === 'chain')).toMatchObject({
      runtime: 'claude',
      model: null,
      runtimeChain: 'failover',
      runtimeSource: 'defaults',
      modelSource: 'runtime',
    });
    expect(plan.steps.find((entry) => entry.id === 'chain')?.launch).toMatchObject({
      chain: 'failover',
      active: false,
    });
  });

  it('uses the default runtime rather than the specialist runtime for an inactive chain', () => {
    const resolved = config(CHAINS);
    const specialist = resolved.specialists.find((item) => item.slug === 'chained')!;
    specialist.runtime = 'opencode';
    specialist.model = 'openai/example';
    resolved.chains.find((chain) => chain.slug === 'failover')!.enabled = false;
    expect(
      pipelineTopology(resolved, 'feature')!.steps.find((step) => step.id === 'chain'),
    ).toMatchObject({
      runtime: 'claude',
      model: null,
      runtimeSource: 'defaults',
      modelSource: 'runtime',
    });
  });
});

describe('the launch plan of a variant', () => {
  const shape = () => pipelineTopology(config(CHAINS), 'feature')!;

  it('marks the model a variant sets and keeps the runtime of the specialist', () => {
    const strong = shape().variants.find((variant) => variant.id === 'strong')!;
    expect(strong.steps.find((step) => step.id === 'code')).toMatchObject({
      model: 'openai/gpt-5',
      runtime: 'opencode',
      runtimeChain: null,
      runtimeSource: 'specialist',
      modelSource: 'variant',
      launch: null,
    });
  });

  it('marks the runtime a variant sets and drops the model of the old runtime', () => {
    const other = shape().variants.find((variant) => variant.id === 'other')!;
    expect(other.steps.find((step) => step.id === 'code')).toMatchObject({
      runtime: 'claude',
      model: null,
      runtimeSource: 'variant',
      modelSource: 'runtime',
    });
  });

  it('shows the chain a variant sets as the launch choice', () => {
    const chained = shape().variants.find((variant) => variant.id === 'chained')!;
    expect(chained.steps.find((step) => step.id === 'code')).toMatchObject({
      runtimeChain: 'failover',
      runtimeSource: 'chain',
      modelSource: 'chain',
      launch: { chain: 'failover', active: true },
    });
  });
});

describe('the launch plan in the snapshot of a run', () => {
  it('keeps the variant as the source of the model', () => {
    const state = run(1, { configText: CHAINS, variant: 'strong' });
    expect(topology(state).steps.find((step) => step.id === 'code')).toMatchObject({
      model: 'openai/gpt-5',
      runtime: 'opencode',
      runtimeSource: 'specialist',
      modelSource: 'variant',
      launch: null,
    });
  });

  it('keeps the chain of the specialist of the snapshot', () => {
    const state = run(1, { configText: CHAINS });
    expect(topology(state).steps.find((step) => step.id === 'chain')).toMatchObject({
      runtimeChain: 'failover',
      runtimeSource: 'chain',
      modelSource: 'chain',
    });
  });
});

describe('the launch plan of the split', () => {
  const TEXT = `${CHAINS}
    epic:
      split: { specialist: chained, pipeline: feature }
`;

  it('shows the plan of the split specialist in the pipeline topology', () => {
    const plan = pipelineTopology(config(TEXT), 'epic')!;
    expect(plan.split).toMatchObject({
      specialist: 'chained',
      runtime: 'claude',
      model: null,
      runtimeChain: 'failover',
      runtimeSource: 'chain',
      modelSource: 'chain',
      launch: { chain: 'failover', mode: 'on_error', active: true },
    });
  });

  it('shows the plan and the status in the topology of a run', () => {
    const state = run(1, { configText: TEXT, split: true });
    state.run.pipeline = 'epic';
    const view = topology(state);
    expect(view.split).toMatchObject({
      specialist: 'chained',
      runtimeChain: 'failover',
      launch: { chain: 'failover', active: true },
    });
  });
});
