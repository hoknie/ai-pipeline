// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { GroupScreen } from '../src/components/runs/GroupScreen.tsx';
import TopologyPage from '../src/components/TopologyPage.tsx';
import {
  FALLBACK_HEIGHT,
  RESOLVER_GAP,
  layout,
  liveState,
  stabilize,
  stabilizeEdges,
  type Size,
} from '../src/components/topologyLayout.ts';
import { formatRoute, parseRoute } from '../src/route.ts';

import {
  FakeEventSource,
  fakeApi,
  groupRow,
  groupView,
  openFake,
  runView,
  topologyOf,
  workflowOf,
  workflowsView,
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
    });
    expect(parseRoute('#topology/feature')).toEqual({
      view: 'topology',
      run: 'feature',
      group: null,
      step: null,
    });
    expect(parseRoute('#r1/login')).toEqual({
      view: 'runs',
      run: 'r1',
      group: 'login',
      step: null,
    });
    expect(parseRoute('')).toEqual({ view: 'runs', run: null, group: null, step: null });
    expect(formatRoute({ view: 'runs', run: 'r1', group: 'login', step: 'code' })).toBe(
      '#runs/r1/login/code',
    );
    expect(formatRoute({ view: 'topology', run: 'feature', group: null, step: null })).toBe(
      '#topology/feature',
    );
  });
});

describe('layout', () => {
  it('lays a workflow left to right with reject arcs, the resolver and the groups of active runs', () => {
    const workflow = workflowOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
    const runs = [
      runView({ id: 'a', title: 'Первый' }),
      runView({ id: 'b', title: 'Второй', topology: onReview() }),
      runView({ id: 'c', finished: true }),
      runView({ id: 'd', workflow: 'epic' }),
    ];
    const live = liveState(workflow, runs, '/repo');
    expect(live.runs).toBe(2);
    const { nodes, edges } = layout(workflow, live, i18next.t);
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
  });
});

describe('topology page', () => {
  function page(runs = [runView()], workflows = workflowsView()) {
    const api = fakeApi({ workflows: vi.fn(async () => workflows) });
    const open = vi.fn();
    const select = vi.fn();
    const view = render(
      <TopologyPage
        api={api}
        runs={runs}
        workflow={null}
        onSelectWorkflow={select}
        onOpenGroup={open}
      />,
    );
    return { api, open, select, view };
  }

  it('shows the target workflow on the split node of an epic that runs by its steps', async () => {
    const workflows = workflowsView({
      workflows: [
        workflowOf({
          id: 'epic',
          split: { specialist: 'plan', maxGroups: 3, workflow: 'explore' },
          steps: workflowOf().steps.map((step) => ({ ...step, id: `explore-${step.id}` })),
        }),
      ],
    });
    const api = fakeApi({ workflows: vi.fn(async () => workflows) });
    render(
      <TopologyPage
        api={api}
        runs={[]}
        workflow="epic"
        onSelectWorkflow={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    const split = await screen.findByTestId('stage-split');
    expect(split.textContent).toContain('explore');
    expect(await screen.findByTestId('stage-explore-code')).toBeTruthy();
  });

  it('lists every workflow with its active runs and shows who is on which step', async () => {
    const workflows = workflowsView({
      workflows: [
        workflowOf(),
        workflowOf({ id: 'epic', split: { specialist: 'plan', maxGroups: 3, workflow: null } }),
      ],
    });
    const { view, select } = page(
      [
        runView({ id: 'a', title: 'Первый' }),
        runView({ id: 'b', title: 'Второй', topology: onReview() }),
      ],
      workflows,
    );
    const list = await screen.findByRole('list', { name: 'workflow' });
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
        api={fakeApi({ workflows: vi.fn(async () => workflows) })}
        runs={[]}
        workflow="epic"
        onSelectWorkflow={select}
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
        workflow={null}
        onSelectWorkflow={vi.fn()}
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
    const side = screen.getByRole('complementary', { name: 'node code' });
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
      workflowsView({
        workflows: [],
        errors: [
          { file: '/repo/aip/settings.yaml', path: 'swarm.max', message: 'must be an integer' },
        ],
      }),
    );
    const errors = await screen.findByRole('region', { name: 'configuration errors' });
    expect(within(errors).getByText('swarm.max')).toBeTruthy();
    expect(within(errors).getByText('/repo/aip/settings.yaml')).toBeTruthy();
  });
});

describe('edit link', () => {
  it('opens the workflow editor from the topology', async () => {
    window.location.hash = '#topology/feature';
    render(<App api={fakeApi()} openStream={openFake} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Edit' }));
    expect(window.location.hash).toBe('#workflows/feature');
    expect(screen.getByRole('link', { name: 'Workflow' }).getAttribute('aria-current')).toBe(
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
  it('opens the workflow of the selected run and returns to the group with the step opened', async () => {
    const api = fakeApi({
      group: vi.fn(async () =>
        groupView({
          attempts: [
            {
              ...groupView().attempts[0]!,
              seq: 1,
              stepId: 'code',
              status: 'finished',
              verdict: 'done',
            },
            {
              ...groupView().attempts[0]!,
              seq: 2,
              stepId: 'review',
              status: 'finished',
              verdict: 'rejected',
            },
            {
              ...groupView().attempts[0]!,
              seq: 3,
              stepId: 'code',
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
      within(screen.getByRole('complementary', { name: 'node code' })).getByRole('button', {
        name: 'Вход',
      }),
    );
    await screen.findByText('#3 code');
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
              status: 'finished',
              verdict: 'done',
            },
            {
              ...groupView().attempts[0]!,
              seq: 2,
              stepId: 'review',
              status: 'finished',
              verdict: 'rejected',
            },
            {
              ...groupView().attempts[0]!,
              seq: 3,
              stepId: 'code',
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
    await screen.findByText('#2 review');
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
  const workflow = workflowOf({ delivery: { mode: 'worktree', resolver: 'coder' } });
  const build = (runs = [runView({ id: 'a' })], sizes = new Map<string, Size>()) =>
    layout(workflow, liveState(workflow, runs, '/repo'), i18next.t, sizes);

  it('puts the main line on y = 0 and the resolver under the delivery', () => {
    const { nodes } = build();
    for (const node of nodes.filter((candidate) => candidate.id !== 'resolver')) {
      expect(node.position.y).toBe(0);
    }
    const resolver = (sizes: Map<string, Size>) =>
      layout(workflow, liveState(workflow, [], '/repo'), i18next.t, sizes).nodes.find(
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
    const { nodes } = layout(workflow, liveState(workflow, [], '/repo'), i18next.t);
    for (const node of nodes) {
      expect(node.data.attempts).toBe(node.data.kind === 'step' ? 0 : null);
    }
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

  it('gives a node of another workflow with the same id the cached size', () => {
    const epic = workflowOf({ id: 'epic' });
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
  it('shows zero attempts and keeps the DOM of a step across updates and workflow switches', async () => {
    const workflows = workflowsView({ workflows: [workflowOf(), workflowOf({ id: 'epic' })] });
    const props = (runs: ReturnType<typeof runView>[], id: string | null) => (
      <TopologyPage
        api={fakeApi({ workflows: vi.fn(async () => workflows) })}
        runs={runs}
        workflow={id}
        onSelectWorkflow={vi.fn()}
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
