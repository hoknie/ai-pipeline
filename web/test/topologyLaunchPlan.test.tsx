// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import TopologyPage from '../src/features/topology/TopologyPage.tsx';
import { pipelineStagesOf } from '../src/shared/lib/pipeline/pipelineStages.ts';

import { cleanup, render, screen } from './render.tsx';
import { fakeApi, pipelineOf, pipelinesView, splitOf } from './fixtures.ts';

beforeAll(() => {
  // React Flow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => cleanup());

const FAILOVER = {
  chain: 'failover',
  name: 'Failover',
  mode: 'on_error' as const,
  active: true,
  candidates: [
    { runtime: 'claude' as const, model: 'opus', enabled: true },
    { runtime: 'opencode' as const, model: 'openai/gpt-6', enabled: false },
  ],
};

const withChain = {
  runtime: 'claude' as const,
  model: null,
  modelSource: 'specialist' as const,
  runtimeChain: 'failover',
  runtimeSource: 'chain' as const,
  launch: FAILOVER,
};

/** The pipeline with its stages, as the daemon sends them. */
function shaped(pipeline: ReturnType<typeof pipelineOf>) {
  return { ...pipeline, stages: pipelineStagesOf(pipeline) };
}

const pipeline = () =>
  shaped(
    pipelineOf({
      steps: pipelineOf().steps.map((step) =>
        step.id === 'code' ? { ...step, ...withChain } : step,
      ),
      split: splitOf({ ...withChain, modelSource: 'runtime' as const }),
    }),
  );

function Page() {
  const api = fakeApi({ pipelines: vi.fn(async () => pipelinesView({ pipelines: [pipeline()] })) });
  return (
    <TopologyPage
      api={api}
      runs={[]}
      pipeline="feature"
      onSelectPipeline={vi.fn()}
      onOpenGroup={vi.fn()}
    />
  );
}

describe('the launch plan on the nodes of the topology', () => {
  it('shows the chain and its items on a step of the chain, with the full plan in the tooltip', async () => {
    render(<Page />);
    const code = await screen.findByTestId('detail-code');
    expect(code.textContent).toContain('chain failover (on_error)');
    expect(code.textContent).toContain('claude opus');
    expect(code.textContent).not.toContain('openai/gpt-6');
    const title = code.getAttribute('title') ?? '';
    expect(title).toContain('openai/gpt-6 (off)');
    expect(title).toContain('picked at launch');
  });

  it('shows the executor with its sources on a fixed step', async () => {
    render(<Page />);
    const review = await screen.findByTestId('detail-review');
    expect(review.textContent).toContain('claude sonnet');
    expect(review.getAttribute('title')).toContain('claude (from defaults)');
    expect(review.getAttribute('title')).toContain('sonnet (from specialist)');
  });

  it('shows the launch plan on the split node', async () => {
    render(<Page />);
    const split = await screen.findByTestId('detail-split');
    expect(split.textContent).toContain('chain failover (on_error)');
    expect(split.textContent).toContain('claude opus');
  });

  it('marks an inactive chain with the fallback runtime', async () => {
    const off = shaped(
      pipelineOf({
        steps: pipelineOf().steps.map((step) =>
          step.id === 'code'
            ? {
                ...step,
                runtimeChain: 'failover',
                runtimeSource: 'defaults' as const,
                modelSource: 'runtime' as const,
                launch: { ...FAILOVER, active: false },
              }
            : step,
        ),
      }),
    );
    const api = fakeApi({ pipelines: vi.fn(async () => pipelinesView({ pipelines: [off] })) });
    render(
      <TopologyPage
        api={api}
        runs={[]}
        pipeline="feature"
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const code = await screen.findByTestId('detail-code');
    expect(code.textContent).toContain('chain failover is off — claude');
    expect(code.getAttribute('title')).toContain('picked at launch');
  });
});
