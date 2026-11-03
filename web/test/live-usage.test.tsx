// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from './render.tsx';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { RunHeader } from '../src/components/runs/RunHeader.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import TopologyPage from '../src/components/TopologyPage.tsx';
import { layout, liveState } from '../src/components/topologyLayout.ts';
import { usageText } from '../src/format.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  queueOf,
  queueRun,
  runView,
  topologyOf,
  workflowOf,
  workflowsView,
} from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

const usage = (inputTokens: number, outputTokens: number, costUsd: number | null = null) => ({
  inputTokens,
  outputTokens,
  costUsd,
});

function stream(): FakeEventSource {
  const source = FakeEventSource.last;
  if (!source) throw new Error('no event source');
  return source;
}

describe('usageText', () => {
  it('is compact in and out tokens, and empty without usage', () => {
    expect(usageText(usage(12_300, 1_100))).toBe('12.3k/1.1k');
    expect(usageText(usage(2_500, 130))).toBe('2.5k/130');
    expect(usageText(usage(2_000_000, 5))).toBe('2.0M/5');
    expect(usageText(null)).toBe('');
    expect(usageText(undefined)).toBe('');
    expect(usageText(usage(0, 0, 0.5))).toBe('');
  });
});

describe('tokens of a run', () => {
  const run = runView({ usage: usage(12_300, 1_100) });
  const props = {
    selectedRun: null,
    selectedGroup: null,
    now: 0,
    query: '',
    onQuery: () => undefined,
    filter: 'all' as const,
    onFilter: () => undefined,
    onSelect: () => undefined,
    scope: 'repository' as const,
    onScope: () => undefined,
    repository: null,
    tagIds: [],
    onTagIds: () => undefined,
  };

  it('shows them in the list and the header, and no dollars while the cost is unknown', () => {
    render(<RunList runs={[run]} {...props} />);
    expect(screen.getByText('12.3k/1.1k')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    cleanup();
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={() => undefined} />);
    expect(screen.getByText('12.3k/1.1k')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('shows the cost next to the tokens when it is known', () => {
    render(<RunList runs={[runView({ usage: usage(1_000, 100, 0.5) })]} {...props} />);
    expect(screen.getByText('1.0k/100')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
  });

  it('shows none for a run without usage', () => {
    render(<RunList runs={[runView({ usage: null })]} {...props} />);
    expect(screen.queryByText(/\d\/\d/)).toBeNull();
  });
});

describe('live update', () => {
  it('changes the numbers of the list, the header and the group on a new run event', async () => {
    window.location.hash = '#runs/run1/login';
    const row = groupRow({ usage: usage(12_300, 1_100) });
    const first = runView({ id: 'run1', usage: usage(12_300, 1_100), groups: [row] });
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    render(<App api={api} openStream={openFake} />);
    act(() => stream().send({ event: 'snapshot', seq: 1, runs: [first] }));
    // the list, the header and the group header
    expect(await screen.findAllByText('12.3k/1.1k')).toHaveLength(3);
    const next = runView({
      id: 'run1',
      usage: usage(22_300, 1_100),
      groups: [{ ...row, usage: usage(22_300, 1_100) }],
    });
    act(() => stream().send({ event: 'run', seq: 2, run: next }));
    await waitFor(() => expect(screen.getAllByText('22.3k/1.1k')).toHaveLength(3));
    expect(screen.queryByText('12.3k/1.1k')).toBeNull();
  });
});

describe('queue card', () => {
  it('shows the tokens of a run of the queue', async () => {
    window.location.hash = '#queue';
    const api = fakeApi({
      queue: vi.fn(async () =>
        queueOf({ status: 'running', runs: [queueRun('run1', { usage: usage(2_500, 130) })] }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    const card = await screen.findByRole('group', { name: 'run1' });
    expect(within(card).getByText('2.5k/130')).toBeTruthy();
    expect(within(card).queryByText(/\$/)).toBeNull();
  });

  it('shows the cost next to the tokens', async () => {
    window.location.hash = '#queue';
    const api = fakeApi({
      queue: vi.fn(async () =>
        queueOf({
          status: 'running',
          runs: [queueRun('run1', { usage: usage(2_500, 130, 0.42) })],
        }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    const card = await screen.findByRole('group', { name: 'run1' });
    expect(within(card).getByText('2.5k/130')).toBeTruthy();
    expect(within(card).getByText('$0.42')).toBeTruthy();
  });

  it('shows none for a run without usage', async () => {
    window.location.hash = '#queue';
    const api = fakeApi({
      queue: vi.fn(async () => queueOf({ status: 'running', runs: [queueRun('run1')] })),
    });
    render(<App api={api} openStream={openFake} />);
    const card = await screen.findByRole('group', { name: 'run1' });
    expect(within(card).queryByText(/\d\/\d/)).toBeNull();
  });
});

describe('tokens of a step node', () => {
  const workflow = workflowOf();
  const onStep = (id: string, input: number) => {
    const base = topologyOf();
    return runView({
      id,
      topology: {
        ...base,
        steps: base.steps.map((step) =>
          step.id === 'code' ? { ...step, attempts: 1, usage: usage(input, 500) } : step,
        ),
      },
    });
  };

  it('sums the tokens of the steps of the active runs', () => {
    const live = liveState(workflow, [onStep('a', 5_000), onStep('b', 7_000)], '/repo');
    const { nodes } = layout(workflow, live, i18next.t);
    const code = nodes.find((node) => node.id === 'step:code')!;
    expect(code.data).toMatchObject({ attempts: 2, inputTokens: 12_000, outputTokens: 1_000 });
  });

  it('shows the attempts and the tokens in the node', async () => {
    render(
      <TopologyPage
        api={fakeApi({ workflows: vi.fn(async () => workflowsView({ workflows: [workflow] })) })}
        runs={[onStep('a', 5_000), onStep('b', 7_000)]}
        workflow="feature"
        onSelectWorkflow={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByText(/attempts 2/).textContent).toBe('attempts 2');
    expect(within(code).getByTestId('usage-code').textContent).toBe('12.0k/1.0k');
    expect(within(code).queryByText(/\$/)).toBeNull();
  });

  it('sums the known costs and keeps null when none is known', () => {
    const withCost = (id: string, c: number | null) => {
      const base = topologyOf();
      return runView({
        id,
        topology: {
          ...base,
          steps: base.steps.map((step) =>
            step.id === 'code' ? { ...step, attempts: 1, usage: usage(1_000, 100, c) } : step,
          ),
        },
      });
    };
    const costOf = (runs: ReturnType<typeof runView>[]) =>
      layout(workflow, liveState(workflow, runs, '/repo'), i18next.t).nodes.find(
        (node) => node.id === 'step:code',
      )!.data.costUsd;
    expect(costOf([withCost('a', 0.4), withCost('b', 0.5)])).toBeCloseTo(0.9);
    expect(costOf([withCost('a', null), withCost('b', null)])).toBeNull();
    expect(costOf([withCost('a', 0.4), withCost('b', null)])).toBeCloseTo(0.4);
  });

  it('shows tokens and cost in the usage line', async () => {
    const withCost = (id: string, input: number, c: number) => {
      const base = topologyOf();
      return runView({
        id,
        topology: {
          ...base,
          steps: base.steps.map((step) =>
            step.id === 'code' ? { ...step, attempts: 1, usage: usage(input, 500, c) } : step,
          ),
        },
      });
    };
    render(
      <TopologyPage
        api={fakeApi({ workflows: vi.fn(async () => workflowsView({ workflows: [workflow] })) })}
        runs={[withCost('a', 5_000, 0.4), withCost('b', 7_000, 0.5)]}
        workflow="feature"
        onSelectWorkflow={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByTestId('usage-code').textContent).toBe('12.0k/1.0k · $0.90');
  });

  it('leaves the line of a step without usage as it was', async () => {
    render(
      <TopologyPage
        api={fakeApi({ workflows: vi.fn(async () => workflowsView({ workflows: [workflow] })) })}
        runs={[]}
        workflow="feature"
        onSelectWorkflow={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByText('attempts 0').textContent).toBe('attempts 0');
    expect(within(code).getByTestId('usage-code').textContent).toBe('—');
  });
});
