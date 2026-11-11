// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { GroupScreen } from '../src/features/runs/group/GroupScreen.tsx';
import TopologyPage from '../src/features/topology/TopologyPage.tsx';
import {
  FALLBACK_HEIGHT,
  RESOLVER_GAP,
  layout,
  liveState,
  stabilize,
  stabilizeEdges,
  type Size,
} from '../src/features/topology/topologyLayout.ts';
import { pipelineStagesOf, type PipelineStage } from '../src/shared/lib/pipeline/pipelineStages.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import { machineLoad } from '../src/shared/lib/pipeline/specialistLoad.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  runView,
  specialistUse,
  topologyOf,
  pipelineOf,
  pipelinesView,
} from './fixtures.ts';

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

const onReview = () => {
  const moved = topologyOf();
  moved.steps[1] = { ...moved.steps[1]!, groups: [] };
  moved.steps[2] = {
    ...moved.steps[2]!,
    groups: [{ slug: 'signup', title: 'Регистрация', status: 'running' }],
  };
  return moved;
};

describe('routes', () => {
  it('reads and writes the run and topology routes and the older form', () => {
    expect(parseRoute('#runs/r1/login/review')).toEqual({
      view: 'runs',
      run: 'r1',
      group: 'login',
      step: 'review',
      tab: null,
    });
    expect(parseRoute('#topology/feature')).toEqual({
      view: 'topology',
      run: 'feature',
      group: null,
      step: null,
      tab: null,
    });
    expect(parseRoute('#r1/login')).toEqual({
      view: 'runs',
      run: 'r1',
      group: 'login',
      step: null,
      tab: null,
    });
    expect(parseRoute('')).toEqual({ view: 'runs', run: null, group: null, step: null, tab: null });
    expect(formatRoute({ view: 'runs', run: 'r1', group: 'login', step: 'code', tab: null })).toBe(
      '#runs/r1/login/code',
    );
    expect(
      formatRoute({ view: 'topology', run: 'feature', group: null, step: null, tab: null }),
    ).toBe('#topology/feature');
  });
});

describe('layout', () => {
  it('lays a pipeline left to right with reject arcs, the resolver and the groups of active runs', () => {
    const pipeline = pipelineOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
    const runs = [
      runView({ id: 'a', title: 'Первый' }),
      runView({ id: 'b', title: 'Второй', topology: onReview() }),
      runView({ id: 'c', finished: true }),
      runView({ id: 'd', pipeline: 'epic' }),
    ];
    const live = liveState(pipeline, runs, '/repo');
    expect(live.runs).toBe(2);
    const { nodes, edges } = layout(pipeline, live, i18next.t);
    expect(nodes.map((node) => node.id)).toEqual([
      'step:plan',
      'step:code',
      'step:review',
      'merge',
      'delivery',
      'resolver',
    ]);
    expect(nodes.find((node) => node.id === 'step:code')?.data.groups).toEqual([
      { runId: 'a', runTitle: 'Первый', slug: 'login', title: 'Вход', status: 'running' },
    ]);
    expect(
      nodes.find((node) => node.id === 'step:review')?.data.groups.map((group) => group.runId),
    ).toEqual(['b']);
    expect(edges.find((edge) => edge.id === 'reject:review->code')).toMatchObject({ label: '≤ 3' });
    expect(edges.map((edge) => edge.id)).toContain('delivery->resolver');
    for (const edge of edges) expect(edge.type).toBe('orthogonal');
    const route = (
      edges.find((edge) => edge.id === 'reject:review->code')?.data as {
        route: { points: { y: number }[] };
      }
    ).route;
    const lane = route.points[1]!.y;
    const bottom = Math.max(
      ...nodes
        .filter((node) => node.id.startsWith('step:'))
        .map((node) => node.position.y + FALLBACK_HEIGHT / 2),
    );
    expect(lane).toBeGreaterThanOrEqual(bottom + 24);
  });

  it('draws an order edge as one straight segment before the nodes are measured', () => {
    const pipeline = pipelineOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
    const { edges } = layout(pipeline, liveState(pipeline, [], '/repo'), i18next.t);
    const order = edges.find((edge) => edge.id.startsWith('plan->') || edge.source === 'step:plan');
    const points = (order?.data as { route: { points: { x: number; y: number }[] } }).route.points;
    expect(points).toHaveLength(2);
    expect(points[0]!.y).toBe(points[1]!.y);
  });
});

describe('topology page', () => {
  function page(runs = [runView()], pipelines = pipelinesView()) {
    const api = fakeApi({ pipelines: vi.fn(async () => pipelines) });
    const open = vi.fn();
    const select = vi.fn();
    const view = render(
      <TopologyPage
        api={api}
        runs={runs}
        pipeline={null}
        onSelectPipeline={select}
        onOpenGroup={open}
      />,
    );
    return { api, open, select, view };
  }

  it('shows the target pipeline on the split node of an epic that runs by its steps', async () => {
    const pipelines = pipelinesView({
      pipelines: [
        pipelineOf({
          id: 'epic',
          split: { specialist: 'plan', maxGroups: 3, pipeline: 'explore', pipelineName: 'explore' },
          steps: pipelineOf().steps.map((step) => ({ ...step, id: `explore-${step.id}` })),
        }),
      ],
    });
    const api = fakeApi({ pipelines: vi.fn(async () => pipelines) });
    render(
      <TopologyPage
        api={api}
        runs={[]}
        pipeline="epic"
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const split = await screen.findByTestId('stage-split');
    expect(split.textContent).toContain('explore');
    expect(await screen.findByTestId('stage-explore-code')).toBeTruthy();
  });

  it('lists every pipeline with its active runs and shows who is on which step', async () => {
    const pipelines = pipelinesView({
      pipelines: [
        pipelineOf(),
        pipelineOf({
          id: 'epic',
          split: { specialist: 'plan', maxGroups: 3, pipeline: null, pipelineName: null },
        }),
      ],
    });
    const { view, select } = page(
      [
        runView({ id: 'a', title: 'Первый' }),
        runView({ id: 'b', title: 'Второй', topology: onReview() }),
      ],
      pipelines,
    );
    const list = await screen.findByRole('list', { name: 'pipeline' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expect.stringContaining('active: 2'), expect.stringContaining('no active runs')]);
    await screen.findByTestId('stage-code');
    expect(within(screen.getByTestId('stage-code')).getByText('Вход')).toBeTruthy();
    expect(within(screen.getByTestId('stage-review')).getByText('Регистрация')).toBeTruthy();
    expect(screen.getByTestId('stage-review').className).toContain('ring-status-run-bg');
    fireEvent.click(within(list).getByText('epic'));
    expect(select).toHaveBeenCalledWith('epic');
    view.rerender(
      <TopologyPage
        api={fakeApi({ pipelines: vi.fn(async () => pipelines) })}
        runs={[]}
        pipeline="epic"
        onSelectPipeline={select}
        onOpenGroup={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('stage-split')).toBeTruthy();
  });

  it('follows a group to its next step', async () => {
    const { view } = page([runView({ id: 'a' })]);
    await screen.findByTestId('stage-code');
    expect(within(screen.getByTestId('stage-code')).getByText('Вход')).toBeTruthy();
    const moved = topologyOf();
    moved.steps[1] = { ...moved.steps[1]!, groups: [] };
    moved.steps[2] = {
      ...moved.steps[2]!,
      groups: [{ slug: 'login', title: 'Вход', status: 'running' }],
    };
    view.rerender(
      <TopologyPage
        api={fakeApi()}
        runs={[runView({ id: 'a', topology: moved })]}
        pipeline={null}
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(within(screen.getByTestId('stage-review')).getByText('Вход')).toBeTruthy(),
    );
    expect(within(screen.getByTestId('stage-code')).queryByText('Вход')).toBeNull();
  });

  it('lists the groups of a clicked step and opens one with that step', async () => {
    const { open } = page([runView({ id: 'a', title: 'Первый' })]);
    fireEvent.click(await screen.findByTestId('stage-code'));
    const side = screen.getByRole('complementary', { name: 'node coder' });
    expect(within(side).getByText('Первый')).toBeTruthy();
    fireEvent.click(within(side).getByRole('button', { name: 'Вход' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'a', slug: 'login' }),
      'code',
    );
  });

  it('shows the errors of a broken configuration with their files', async () => {
    page(
      [],
      pipelinesView({
        pipelines: [],
        errors: [
          { file: '/repo/aip/settings.yaml', path: 'swarm.max', message: 'must be an integer' },
        ],
      }),
    );
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.max')).toBeTruthy();
    const file = within(errors).getByText('/repo/aip/settings.yaml');
    expect(file.tagName).toBe('CODE');
    expect(file.className).toContain('bg-muted');
    expect(file.getAttribute('title')).toBe('/repo/aip/settings.yaml');
  });
});

describe('edit link', () => {
  it('opens the pipeline editor from the topology', async () => {
    window.location.hash = '#topology/feature';
    render(<App api={fakeApi()} openStream={openFake} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Edit' }));
    expect(window.location.hash).toBe('#pipelines/feature');
    expect(screen.getByRole('link', { name: 'Pipeline' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

/** Which attempts of the log are open, in order. */
const expanded = () =>
  screen
    .getAllByRole('button', { name: /^attempt \d+/ })
    .map((button) => button.getAttribute('aria-expanded') === 'true');

describe('tabs', () => {
  it('opens the pipeline of the selected run and returns to the group with the step opened', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [
            {
              ...groupView().attempts[0]!,
              seq: 1,
              stepId: 'code',
              stepName: 'Кодер',
              status: 'finished',
              verdict: 'done',
            },
            {
              ...groupView().attempts[0]!,
              seq: 2,
              stepId: 'review',
              stepName: 'Ревьюер',
              status: 'finished',
              verdict: 'rejected',
            },
            {
              ...groupView().attempts[0]!,
              seq: 3,
              stepId: 'code',
              stepName: 'Кодер',
              status: 'running',
              verdict: null,
            },
          ],
        }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      FakeEventSource.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView({ groups: [groupRow()] })],
      }),
    );
    // the first run opens once the panel knows its repository
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1'));
    fireEvent.click(screen.getByRole('link', { name: 'Topology' }));
    await screen.findByTestId('stage-review');
    expect(window.location.hash).toBe('#topology/feature');
    expect(screen.getByRole('link', { name: 'Topology' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(screen.getByTestId('stage-code'));
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'node coder' })).getByRole('button', {
        name: 'Вход',
      }),
    );
    await screen.findByText('#3 Кодер');
    expect(window.location.hash).toBe('#runs/run1/login/code');
    expect(expanded()).toEqual([false, false, true]);
    expect(screen.getByRole('tab', { name: 'Log' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens the last attempt of the step given in the address', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [
            {
              ...groupView().attempts[0]!,
              seq: 1,
              stepId: 'code',
              stepName: 'Кодер',
              status: 'finished',
              verdict: 'done',
            },
            {
              ...groupView().attempts[0]!,
              seq: 2,
              stepId: 'review',
              stepName: 'Ревьюер',
              status: 'finished',
              verdict: 'rejected',
            },
            {
              ...groupView().attempts[0]!,
              seq: 3,
              stepId: 'code',
              stepName: 'Кодер',
              status: 'running',
              verdict: null,
            },
          ],
        }),
      ),
    });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={groupRow()}
        openStep="review"
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={() => undefined}
      />,
    );
    await screen.findByText('#2 Ревьюер');
    await waitFor(() => expect(expanded()).toEqual([false, true, false]));
  });

  it('still opens an older link of a group', () => {
    window.location.hash = '#run1/login';
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() => FakeEventSource.last?.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
    expect(screen.getByRole('region', { name: 'group Вход' })).toBeTruthy();
    expect(window.location.hash).toBe('#runs/run1/login');
  });
});

describe('stable layout', () => {
  const pipeline = pipelineOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
  const build = (runs = [runView({ id: 'a' })], sizes = new Map<string, Size>()) =>
    layout(pipeline, liveState(pipeline, runs, '/repo'), i18next.t, sizes);

  it('puts the main line on y = 0 and the resolver under the delivery', () => {
    const { nodes } = build();
    for (const node of nodes.filter((candidate) => candidate.id !== 'resolver')) {
      expect(node.position.y).toBe(0);
    }
    const resolver = (sizes: Map<string, Size>) =>
      layout(pipeline, liveState(pipeline, [], '/repo'), i18next.t, sizes).nodes.find(
        (node) => node.id === 'resolver',
      )!;
    expect(resolver(new Map()).position.y).toBe(FALLBACK_HEIGHT + RESOLVER_GAP);
    expect(
      resolver(
        new Map([
          ['delivery', { width: 100, height: 200 }],
          ['resolver', { width: 100, height: 60 }],
        ]),
      ).position.y,
    ).toBe(100 + RESOLVER_GAP + 30);
  });

  it('gives every step a number of attempts and services none', () => {
    const { nodes } = layout(pipeline, liveState(pipeline, [], '/repo'), i18next.t);
    for (const node of nodes) {
      expect(node.data.attempts).toBe(node.data.kind === 'step' ? 0 : null);
    }
  });

  it('keeps the edge of a return when only the data of a node changes', () => {
    const sizes = new Map<string, Size>([['step:code', { width: 150, height: 80 }]]);
    const firstEdges = stabilizeEdges([], build(undefined, sizes).edges);
    const changed = build([runView({ id: 'a', topology: onReview() })], sizes);
    const nextEdges = stabilizeEdges(firstEdges, changed.edges);
    const at = firstEdges.findIndex((edge) => edge.id === 'reject:review->code');
    expect(nextEdges[at]).toBe(firstEdges[at]);
  });

  it('keeps unchanged nodes and edges, replaces only the changed ones with the cached size', () => {
    const sizes = new Map<string, Size>([['step:code', { width: 150, height: 80 }]]);
    const first = stabilize([], build().nodes, sizes, null);
    const firstEdges = stabilizeEdges([], build().edges);
    const same = stabilize(first, build().nodes, sizes, null);
    same.forEach((node, index) => expect(node).toBe(first[index]));
    stabilizeEdges(firstEdges, build().edges).forEach((edge, index) =>
      expect(edge).toBe(firstEdges[index]),
    );

    const moved = build([runView({ id: 'a', topology: onReview() })]);
    const next = stabilize(first, moved.nodes, sizes, null);
    const changed = next.filter((node, index) => node !== first[index]).map((node) => node.id);
    expect(changed).toEqual(['step:code', 'step:review']);
    expect(next.find((node) => node.id === 'step:code')?.measured).toEqual({
      width: 150,
      height: 80,
    });
    const movedEdges = stabilizeEdges(firstEdges, moved.edges);
    expect(movedEdges.filter((edge, index) => edge !== firstEdges[index]).length).toBeLessThan(
      firstEdges.length,
    );
  });

  it('changes only two nodes when the selection moves', () => {
    const raw = build().nodes;
    const first = stabilize([], raw, new Map(), 'step:code');
    const next = stabilize(first, raw, new Map(), 'step:review');
    expect(next.filter((node, index) => node !== first[index]).map((node) => node.id)).toEqual([
      'step:code',
      'step:review',
    ]);
  });

  it('gives a node of another pipeline with the same id the cached size', () => {
    const epic = pipelineOf({ id: 'epic' });
    const sizes = new Map<string, Size>([['step:code', { width: 150, height: 80 }]]);
    const nodes = stabilize(
      [],
      layout(epic, liveState(epic, [], '/repo'), i18next.t).nodes,
      sizes,
      null,
    );
    expect(nodes.find((node) => node.id === 'step:code')?.measured).toEqual(sizes.get('step:code'));
  });
});

describe('stable topology page', () => {
  it('shows zero attempts and keeps the DOM of a step across updates and pipeline switches', async () => {
    const pipelines = pipelinesView({ pipelines: [pipelineOf(), pipelineOf({ id: 'epic' })] });
    const props = (runs: ReturnType<typeof runView>[], id: string | null) => (
      <TopologyPage
        api={fakeApi({ pipelines: vi.fn(async () => pipelines) })}
        runs={runs}
        pipeline={id}
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />
    );
    const view = render(props([], 'feature'));
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByText('attempts 0')).toBeTruthy();
    view.rerender(props([], 'feature'));
    expect(screen.getByTestId('stage-code')).toBe(code);
    view.rerender(props([], 'epic'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'epic' })).toBeTruthy());
    expect(screen.getByTestId('stage-code')).toBe(code);
  });
});

describe('specialist occupancy', () => {
  const pipeline = pipelineOf({ limits: { coder: 1 } });
  const other = (overrides: Partial<ReturnType<typeof runView>> = {}) =>
    runView({
      id: 'x',
      title: 'Чужой',
      repository: '/other',
      pipeline: 'epic',
      specialists: [specialistUse('coder', { level: 'global', name: 'Кодер', running: ['api'] })],
      ...overrides,
    });
  const busyOf = (runs: ReturnType<typeof runView>[], id = 'step:code') => {
    const live = liveState(pipeline, runs, '/repo');
    const { nodes } = layout(pipeline, live, i18next.t, new Map(), machineLoad(runs));
    return nodes.find((node) => node.id === id)?.data.busy;
  };

  it('counts a specialist busy in another repository and another pipeline', () => {
    expect(busyOf([other()])).toEqual({ running: 1, elsewhere: 1, max: 1, full: true });
    expect(busyOf([other({ repository: '/repo', pipeline: 'epic' })])).toEqual({
      running: 1,
      elsewhere: 1,
      max: 1,
      full: true,
    });
  });

  it('shows a free specialist and the own runs without elsewhere', () => {
    expect(busyOf([])).toEqual({ running: 0, elsewhere: 0, max: 1, full: false });
    const own = runView({
      id: 'a',
      specialists: [specialistUse('coder', { running: ['login'] })],
    });
    expect(busyOf([own])).toEqual({ running: 1, elsewhere: 0, max: 1, full: true });
  });

  it('takes the smallest limit of the runs and the pipeline', () => {
    const limited = other({
      specialists: [specialistUse('coder', { max: 2, running: ['api'] })],
    });
    expect(busyOf([limited])?.max).toBe(1);
    expect(
      busyOf([
        limited,
        other({ id: 'y', specialists: [specialistUse('coder', { max: 1, running: ['z'] })] }),
      ])?.max,
    ).toBe(1);
  });

  it('has no busy state on the merge node', () => {
    expect(busyOf([other()], 'merge')).toBeNull();
  });

  it('replaces only the node of the specialist when another run changes its load', () => {
    const render1 = (runs: ReturnType<typeof runView>[]) => {
      const live = liveState(pipeline, runs, '/repo');
      return layout(pipeline, live, i18next.t, new Map(), machineLoad(runs)).nodes;
    };
    const first = stabilize([], render1([other()]), new Map(), null);
    const unrelated = other({
      title: 'Другое название',
      specialists: [specialistUse('coder', { level: 'global', running: ['api'] })],
    });
    stabilize(first, render1([unrelated]), new Map(), null).forEach((node, index) =>
      expect(node).toBe(first[index]),
    );
    const changed = stabilize(first, render1([other({ specialists: [] })]), new Map(), null)
      .filter((node, index) => node !== first[index])
      .map((node) => node.id);
    expect(changed).toEqual(['step:code']);
  });

  it('renders the line on the node and lists the groups of other runs in the panel', async () => {
    const pipelines = pipelinesView({ pipelines: [pipeline] });
    const open = vi.fn();
    const runs = [other()];
    render(
      <TopologyPage
        api={fakeApi({ pipelines: vi.fn(async () => pipelines) })}
        runs={runs}
        pipeline={null}
        onSelectPipeline={vi.fn()}
        onOpenGroup={open}
      />,
    );
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByText('busy 1 of 1 · in other runs: 1')).toBeTruthy();
    expect(code.className).toContain('border-status-warn');
    expect(within(screen.getByTestId('stage-plan')).queryByText(/busy/)).toBeNull();
    fireEvent.click(code);
    const side = screen.getByRole('complementary', { name: 'node coder' });
    expect(within(side).getByText('Specialist busy in other runs')).toBeTruthy();
    expect(within(side).getByText(/Чужой · other/)).toBeTruthy();
    expect(
      within(side).getByText(/other runs and repositories that run on, or wait for, Кодер\./),
    ).toBeTruthy();
    fireEvent.click(within(side).getByRole('button', { name: 'api' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ runId: 'x', slug: 'api' }), 'code');
  });

  it('has no section about other runs when only the own runs use the specialist', async () => {
    const own = runView({
      id: 'a',
      specialists: [specialistUse('coder', { running: ['login'] })],
    });
    render(
      <TopologyPage
        api={fakeApi({ pipelines: vi.fn(async () => pipelinesView({ pipelines: [pipeline] })) })}
        runs={[own]}
        pipeline={null}
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const code = await screen.findByTestId('stage-code');
    expect(within(code).getByText('busy 1 of 1')).toBeTruthy();
    fireEvent.click(code);
    expect(screen.queryByText('Specialist busy in other runs')).toBeNull();
  });
});

describe('wide window', () => {
  it('stretches the graph area over the page without a width limit', async () => {
    const api = fakeApi({ pipelines: vi.fn(async () => pipelinesView()) });
    const { container } = render(
      <TopologyPage
        api={api}
        runs={[runView()]}
        pipeline={null}
        onSelectPipeline={() => undefined}
        onOpenGroup={() => undefined}
      />,
    );
    await screen.findByLabelText(/^pipeline /);
    for (const element of container.querySelectorAll('div, section'))
      expect(element.className).not.toMatch(/(^|\s)(max-w-(?!full)\S+|mx-auto)/);
    const grid = container.querySelector('[class*="lg:grid-cols-[minmax(0,1fr)_18rem]"]');
    expect(grid).not.toBeNull();
  });
});

describe('pipeline stages', () => {
  const spec = (
    id: string,
    kind: PipelineStage['kind'],
    section: PipelineStage['section'],
    extra: Partial<PipelineStage> = {},
  ): PipelineStage => ({
    id,
    kind,
    section,
    name: id,
    performer: { type: 'system' },
    condition: null,
    status: null,
    group: null,
    ...extra,
  });
  const base = pipelineOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
  const specialist = (slug: string) => ({ type: 'specialist' as const, slug, name: slug });
  const stages: PipelineStage[] = [
    spec('action:before_split:lint', 'action', 'prepare', {
      name: 'Линтер',
      performer: { type: 'command', command: 'npm run lint' },
    }),
    ...base.steps.map((step) =>
      spec(`step:${step.id}`, 'step', 'work', {
        name: step.name,
        performer: specialist(step.specialist),
      }),
    ),
    spec('merge', 'merge', 'merge'),
    spec('message', 'message', 'delivery', {
      name: 'Сообщение коммита',
      performer: specialist('coder'),
      condition: 'delivery_commit',
    }),
    spec('delivery', 'delivery', 'delivery'),
    spec('resolve', 'resolve', 'delivery', {
      performer: specialist('coder'),
      condition: 'conflict',
    }),
    spec('action:after_delivery:commit', 'action', 'finish', { name: 'Коммит' }),
    spec('cleanup', 'cleanup', 'finish', { condition: 'not_keep' }),
  ];
  const staged = { ...base, stages };
  const nodesOf = (pipeline: typeof staged | typeof base) =>
    layout(pipeline, liveState(pipeline, [], '/repo'), i18next.t);

  it('lays out nodes in the order of the stages, the resolver under the delivery', () => {
    const { nodes, edges } = nodesOf(staged);
    expect(nodes.map((node) => node.id)).toEqual([
      'action:before_split:lint',
      'step:plan',
      'step:code',
      'step:review',
      'merge',
      'message',
      'delivery',
      'resolver',
      'action:after_delivery:commit',
      'cleanup',
    ]);
    expect(nodes.filter((node) => node.data.sectionStart).map((node) => node.data.section)).toEqual(
      ['prepare', 'work', 'merge', 'delivery', 'finish'],
    );
    const ids = edges.map((edge) => edge.id);
    expect(ids).toContain('delivery->resolver');
    expect(ids).toContain('delivery->action:after_delivery:commit');
    expect(ids).toContain('action:after_delivery:commit->cleanup');
    expect(ids).not.toContain('resolver->action:after_delivery:commit');
    expect(ids).toContain('reject:review->code');
    expect(nodes.find((node) => node.id === 'resolver')?.position.y).toBe(
      FALLBACK_HEIGHT + RESOLVER_GAP,
    );
  });

  it('builds the same order from the older fields while the engine sends no stages', () => {
    const fallback = nodesOf(base);
    expect(fallback.nodes.map((node) => node.id)).toEqual([
      'step:plan',
      'step:code',
      'step:review',
      'merge',
      'delivery',
      'resolver',
    ]);
    const engine = nodesOf({
      ...base,
      stages: stages.filter((stage) => !['action', 'message', 'cleanup'].includes(stage.kind)),
    });
    expect(engine.nodes.map((node) => node.id)).toEqual(fallback.nodes.map((node) => node.id));
    expect(engine.edges.map((edge) => edge.id)).toEqual(fallback.edges.map((edge) => edge.id));
    expect(pipelineStagesOf(base).map((stage) => stage.section)).toEqual([
      'work',
      'work',
      'work',
      'merge',
      'delivery',
      'delivery',
    ]);
  });

  it('shows the performer and the condition on the nodes', () => {
    const { nodes } = nodesOf(staged);
    const data = (id: string) => nodes.find((node) => node.id === id)!.data;
    expect(data('action:before_split:lint').performer).toBe('npm run lint');
    expect(data('merge').performer).toBe(i18next.t('topology.stages.system'));
    expect(data('merge').condition).toBeNull();
    expect(data('resolver').condition).toBe(i18next.t('topology.stages.condition.conflict'));
    expect(data('cleanup').condition).not.toBeNull();
    expect(data('message').link).toBe('#pipelines/system/message');
    expect(data('action:after_delivery:commit').link).toBe('#pipelines/actions/commit');
    expect(data('merge').link).toBeNull();
    expect(data('cleanup').link).toBeNull();
  });

  const splitBase = pipelineOf({
    split: { specialist: 'planner', maxGroups: 3, pipeline: null, pipelineName: null },
    delivery: { mode: 'worktree', resolver: 'coder' },
  });
  const engineStages = (pipeline: typeof splitBase): PipelineStage[] => [
    spec('split', 'split', 'prepare', {
      name: 'planner',
      performer: specialist('planner'),
    }),
    ...pipeline.steps.map((step) =>
      spec(`step:${step.id}`, 'step', 'work', {
        name: step.name,
        performer: specialist(step.specialist),
      }),
    ),
    spec('merge', 'merge', 'merge'),
    spec('delivery', 'delivery', 'delivery'),
    spec('resolve', 'resolve', 'delivery', {
      performer: specialist('coder'),
      condition: 'conflict',
    }),
  ];
  const summary = (pipeline: typeof splitBase | typeof staged) =>
    nodesOf(pipeline).nodes.map((node) => ({
      id: node.id,
      section: node.data.section,
      sectionStart: node.data.sectionStart,
      performer: node.data.performer,
      condition: node.data.condition,
      link: node.data.link,
    }));

  it('places the split between its actions and keeps the same order on both paths', () => {
    const withActions: PipelineStage[] = [
      spec('action:before_split:prep', 'action', 'prepare', { name: 'Prep' }),
      ...engineStages(splitBase).slice(0, 1),
      spec('action:after_split:check', 'action', 'prepare', { name: 'Check' }),
      ...engineStages(splitBase).slice(1),
    ];
    const { nodes } = nodesOf({ ...splitBase, stages: withActions });
    expect(nodes.map((node) => node.id)).toEqual([
      'action:before_split:prep',
      'split',
      'action:after_split:check',
      'step:plan',
      'step:code',
      'step:review',
      'merge',
      'delivery',
      'resolver',
    ]);
    expect(nodes.filter((node) => node.data.sectionStart).map((node) => node.id)).toEqual([
      'action:before_split:prep',
      'step:plan',
      'merge',
      'delivery',
    ]);
    const fallback = nodesOf(splitBase);
    expect(fallback.nodes.map((node) => node.id)).toEqual([
      'split',
      'step:plan',
      'step:code',
      'step:review',
      'merge',
      'delivery',
      'resolver',
    ]);
    const engine = nodesOf({ ...splitBase, stages: engineStages(splitBase) });
    expect(engine.edges.map((edge) => edge.id)).toEqual(fallback.edges.map((edge) => edge.id));
    expect(summary({ ...splitBase, stages: engineStages(splitBase) })).toEqual(summary(splitBase));
  });

  it('carries the section, performer, condition and link on the older path too', () => {
    const data = (id: string) => nodesOf(splitBase).nodes.find((node) => node.id === id)!.data;
    expect(data('resolver').condition).toBe(i18next.t('topology.stages.condition.conflict'));
    expect(data('resolver').performer).toBe('coder');
    expect(data('resolver').link).toBe('#pipelines/system/resolve');
    expect(data('split').link).toBe('#pipelines/system/split');
    expect(data('delivery').link).toBe('#pipelines/system/delivery');
    expect(data('merge').section).toBe('merge');
    expect(data('delivery').performer).toBe(i18next.t('topology.stages.system'));
  });

  it('keeps the first node of every section labelled when a stage is skipped', () => {
    const skipped = [
      spec('step:gone', 'step', 'work'),
      ...stages.filter((stage) => stage.kind !== 'action'),
    ];
    const { nodes } = nodesOf({ ...base, stages: skipped });
    expect(nodes.find((node) => node.id === 'step:plan')?.data.sectionStart).toBe(true);
    expect(
      nodes.filter((node) => node.data.section === 'work' && node.data.sectionStart),
    ).toHaveLength(1);
  });

  it('puts every new kind on one line and keeps the resolver gap with a measured delivery', () => {
    const { nodes } = nodesOf(staged);
    for (const id of ['action:before_split:lint', 'message', 'cleanup'])
      expect(nodes.find((node) => node.id === id)?.position.y).toBe(0);
    const sizes = new Map([
      ['delivery', { width: 200, height: 120 }],
      ['resolver', { width: 200, height: 80 }],
    ]);
    const measured = layout(staged, liveState(staged, [], '/repo'), i18next.t, sizes);
    expect(measured.nodes.find((node) => node.id === 'resolver')?.position.y).toBe(
      60 + RESOLVER_GAP + 40,
    );
  });

  it('titles the message and cleanup nodes from the interface language', () => {
    const { nodes } = nodesOf(staged);
    const title = (id: string) => nodes.find((node) => node.id === id)!.data.title;
    expect(title('message')).toBe(i18next.t('topology.stages.name.message'));
    expect(title('cleanup')).toBe(i18next.t('topology.stages.name.cleanup'));
  });

  it('keeps nodes stable on live updates with the new stages', () => {
    const first = stabilize([], nodesOf(staged).nodes, new Map(), null);
    const again = stabilize(first, nodesOf(staged).nodes, new Map(), null);
    again.forEach((node, index) => expect(node).toBe(first[index]));
  });

  it('marks conditional nodes and opens the description with a link to the Pipeline entry', async () => {
    const api = fakeApi({
      pipelines: vi.fn(async () => pipelinesView({ pipelines: [staged] })),
    });
    render(
      <TopologyPage
        api={api}
        runs={[]}
        pipeline={staged.id}
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const resolver = await screen.findByTestId('stage-resolver');
    expect(resolver.getAttribute('data-conditional')).toBe('true');
    expect(screen.getByTestId('stage-merge').getAttribute('data-conditional')).toBeNull();
    expect(screen.getByTestId('condition-resolver').textContent).toBe(
      i18next.t('topology.stages.condition.conflict'),
    );
    expect(screen.getByTestId('section-delivery').textContent).toBe(
      i18next.t('topology.stages.section.delivery'),
    );
    expect(screen.getByTestId('stage-action:before_split:lint').textContent).toContain(
      'npm run lint',
    );

    expect(screen.getByTestId('performer-merge').textContent).toBe(
      i18next.t('topology.stages.system'),
    );
    expect(screen.getByTestId('performer-delivery').textContent).toBe(
      i18next.t('topology.stages.system'),
    );
    expect(screen.queryByTestId('performer-plan')).toBeNull();

    fireEvent.click(screen.getByTestId('stage-message'));
    const side = screen.getByRole('complementary', { name: 'node Commit message' });
    expect(within(side).getByRole('link', { name: 'Open in Pipeline' }).getAttribute('href')).toBe(
      '#pipelines/system/message',
    );

    fireEvent.click(screen.getByTestId('stage-action:after_delivery:commit'));
    expect(
      within(screen.getByRole('complementary', { name: 'node Коммит' }))
        .getByRole('link', { name: 'Open in Pipeline' })
        .getAttribute('href'),
    ).toBe('#pipelines/actions/commit');

    fireEvent.click(screen.getByTestId('stage-merge'));
    expect(
      within(screen.getByRole('complementary', { name: /node/ })).queryByRole('link', {
        name: 'Open in Pipeline',
      }),
    ).toBeNull();
  });
});
