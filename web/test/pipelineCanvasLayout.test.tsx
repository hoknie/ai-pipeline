// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import { PipelineForm } from '../src/features/pipelines/index.ts';
import {
  FALLBACK_HEIGHT,
  FALLBACK_WIDTH,
  GAP_Y,
  GRID,
  autoLayout,
  layoutIdOf,
  placeNodes,
  resolveOverlap,
  snapPlace,
  type Box,
} from '../src/features/pipelines/form/canvas/canvasLayout.ts';
import {
  anchorsKey,
  edgeAnchorKey,
  reconnectOutcome,
  sideOfHandle,
  withAnchor,
  withoutAnchor,
} from '../src/features/pipelines/form/canvas/canvasAnchors.ts';
import { liveSelection } from '../src/features/pipelines/form/canvas/canvasModel.ts';
import { draftOf, record } from '../src/features/pipelines/form/steps/draft.ts';
import { stepNodeId } from '../src/features/pipelines/form/steps/draftGraph.ts';
import { RESOLVER_OFFSET_Y, canvasNode } from '../src/features/pipelines/form/steps/stageNodes.ts';
import type { EditorPipeline } from '../src/shared/api/types.ts';

import { act, choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fitView, flow } from './fakeFlow.tsx';
import { actionEntry, configView, fakeApi, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('@xyflow/react', async () => (await import('./fakeFlow.tsx')).fakeFlow());

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  fitView.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const at = (x: number, y: number) => ({ x, y });
const box = (id: string, x: number, y: number): Box => ({ id, position: at(x, y) });
const overlap = (a: Box, b: Box) =>
  a.position.x < b.position.x + FALLBACK_WIDTH &&
  a.position.x + FALLBACK_WIDTH > b.position.x &&
  a.position.y < b.position.y + FALLBACK_HEIGHT &&
  a.position.y + FALLBACK_HEIGHT > b.position.y;

describe('the layout of the nodes', () => {
  const chain = () => [
    canvasNode('start', 0, { kind: 'start' }),
    canvasNode('step:1', 240, { kind: 'step', key: 1, title: 'scan' }),
    canvasNode('step:2', 480, { kind: 'step', key: 2, title: 'report' }),
    canvasNode('delivery', 720, { kind: 'delivery' }),
    { ...canvasNode('resolver', 720, { kind: 'resolver' }), position: at(720, RESOLVER_OFFSET_Y) },
  ];
  const positions = (nodes: ReturnType<typeof chain>) =>
    Object.fromEntries(nodes.map((node) => [node.id, node.position]));

  it('names a node by the id of a step and the id of any other node', () => {
    const [start, scan, , delivery] = chain();
    expect(layoutIdOf(start!)).toBe('start');
    expect(layoutIdOf(scan!)).toBe('scan');
    expect(layoutIdOf(delivery!)).toBe('delivery');
    expect(layoutIdOf(canvasNode('step:7', 0, { kind: 'step', key: 7, title: '' }))).toBe('step:7');
  });

  it('keeps the automatic layout of the draft when nothing is remembered', () => {
    const nodes = chain();
    expect(autoLayout(nodes)).toEqual(positions(nodes));
    expect(positions(placeNodes(nodes, {}))).toEqual(positions(nodes));
  });

  it('puts a node on its remembered place and ignores places of nodes that are gone', () => {
    const placed = placeNodes(chain(), { 'step:2': at(5, 300), 'step:9': at(1, 1) });
    expect(placed.find((node) => node.id === 'step:2')!.position).toEqual(at(5, 300));
    expect(placed.map((node) => node.id)).not.toContain('step:9');
    expect(placed.find((node) => node.id === 'step:1')!.position).toEqual(at(240, 0));
  });

  it('puts a new node next to the node before it, where that one stands', () => {
    const placed = placeNodes(chain(), { 'step:1': at(240, 400) });
    expect(placed.find((node) => node.id === 'step:2')!.position).toEqual(at(480, 400));
    expect(placed.find((node) => node.id === 'resolver')!.position).toEqual(at(720, 540));
  });

  it('keeps the middle of the resolver on a row of the grid', () => {
    const resolver = placeNodes(chain(), { 'step:1': at(240, 400) }).find(
      (node) => node.id === 'resolver',
    )!;
    expect((resolver.position.y + FALLBACK_HEIGHT / 2) % GRID).toBe(0);
    expect(RESOLVER_OFFSET_Y % GRID).toBe(0);
  });

  it('moves a node it puts by itself off a node that was moved onto its place', () => {
    const nodes = chain();
    const moved = at(480, 0);
    const placed = placeNodes(nodes, { delivery: at(0, 0), 'step:1': moved });
    const report = placed.find((node) => node.id === 'step:2')!;
    expect(
      overlap(
        report,
        placed.find((node) => node.id === 'step:1')!,
      ),
    ).toBe(false);
    // the nodes that were moved by hand stay
    expect(placed.find((node) => node.id === 'step:1')!.position).toEqual(moved);
    expect(placed.find((node) => node.id === 'delivery')!.position).toEqual(at(0, 0));
    for (const [index, one] of placed.entries()) {
      for (const other of placed.slice(index + 1)) expect(overlap(one, other)).toBe(false);
    }
  });

  it('keeps the place of a node that is being dragged', () => {
    const nodes = chain();
    const current = [{ ...nodes[1]!, position: at(10, 10), dragging: true }];
    expect(placeNodes(nodes, {}, current).find((n) => n.id === 'step:1')!.position).toEqual(
      at(10, 10),
    );
  });

  it('carries the sizes the flow measured over', () => {
    const nodes = chain();
    const current = [{ ...nodes[1]!, measured: { width: 180, height: 60 } }];
    expect(placeNodes(nodes, {}, current).find((n) => n.id === 'step:1')!.measured).toEqual({
      width: 180,
      height: 60,
    });
  });

  describe('a node dropped on another', () => {
    it('stays where it is when the place is free', () => {
      expect(resolveOverlap(box('a', 0, 0), [box('b', 0, 200)])).toEqual(at(0, 0));
    });

    it('moves down to the nearest free place', () => {
      const place = resolveOverlap(box('a', 0, 0), [box('b', 0, 0)]);
      expect(place.x).toBe(0);
      expect(place.y).toBeGreaterThanOrEqual(FALLBACK_HEIGHT);
      expect(place.y % GAP_Y).toBe(0);
      expect(overlap({ id: 'a', position: place }, box('b', 0, 0))).toBe(false);
      // the step before the free place is not free
      expect(overlap(box('a', 0, place.y - GAP_Y), box('b', 0, 0))).toBe(true);
    });

    it('uses the measured sizes', () => {
      const other = { ...box('b', 0, 0), measured: { width: 100, height: 300 } };
      expect(resolveOverlap(box('a', 0, 0), [other]).y).toBeGreaterThanOrEqual(300);
      expect(resolveOverlap(box('a', 120, 0), [other])).toEqual(at(120, 0));
    });

    it('does not take itself for an obstacle', () => {
      expect(resolveOverlap(box('a', 0, 0), [box('a', 0, 0)])).toEqual(at(0, 0));
    });

    it('moves to the right when the column below is full', () => {
      const wall = { ...box('wall', 0, 0), measured: { width: 100, height: 5000 } };
      const place = resolveOverlap(box('a', 0, 0), [wall]);
      expect(place.x).toBeGreaterThanOrEqual(100);
      expect(overlap({ id: 'a', position: place }, { ...wall, measured: undefined })).toBe(false);
    });
  });
});

describe('the grid and the line of the edges', () => {
  it('snaps the left edge to a column and the middle to a row', () => {
    const tall = { ...box('a', 0, 0), measured: { width: 200, height: 110 } };
    expect(snapPlace(box('a', 0, 0), at(13, 17))).toEqual(at(20, 20));
    const place = snapPlace(tall, at(47, 33));
    expect(place.x % GRID).toBe(0);
    expect((place.y + 55) % GRID).toBe(0);
  });

  it('keeps a place that is on the grid', () => {
    expect(snapPlace(box('a', 0, 0), at(240, 0))).toEqual(at(240, 0));
  });

  it('puts the nodes of a row on one line whatever their heights', () => {
    const nodes = [
      canvasNode('start', 0, { kind: 'start' }),
      canvasNode('step:1', 240, { kind: 'step', key: 1, title: 'scan' }),
      canvasNode('step:2', 480, { kind: 'step', key: 2, title: 'report' }),
    ];
    const heights = { start: 60, 'step:1': 100, 'step:2': 140 } as Record<string, number>;
    const current = nodes.map((node) => ({
      ...node,
      measured: { width: 200, height: heights[node.id]! },
    }));
    const placed = placeNodes(nodes, {}, current);
    const middles = placed.map((node) => node.position.y + heights[node.id]! / 2);
    expect(new Set(middles).size).toBe(1);
    expect(middles[0]! % GRID).toBe(0);
  });

  it('does not move a remembered place when the heights are known', () => {
    const nodes = [canvasNode('step:1', 240, { kind: 'step', key: 1, title: 'scan' })];
    const current = [{ ...nodes[0]!, measured: { width: 200, height: 140 } }];
    expect(placeNodes(nodes, { 'step:1': at(7, 9) }, current)[0]!.position).toEqual(at(7, 9));
  });
});

describe('the sides of the connections', () => {
  const draft = draftOf(record(RAW));
  const [plan, code, review] = draft.steps.map((step) => stepNodeId(step.key)) as [
    string,
    string,
    string,
  ];
  const returning = { id: `return:${draft.steps[2]!.key}`, source: review, target: code };
  const ordered = { id: `next:${plan}->${code}`, source: plan, target: code };

  it('names a connection by the layout ids of its nodes', () => {
    expect(edgeAnchorKey('next:a->b', 'scan', 'report')).toBe('scan->report');
    expect(edgeAnchorKey('return:3', 'review', 'code')).toBe('return:review->code');
    expect(anchorsKey('/repo', 'explore')).toBe('canvasAnchors./repo.explore');
    expect(sideOfHandle('left')).toBe('left');
    expect(sideOfHandle('back-out')).toBeUndefined();
  });

  it('sets and forgets the sides of a connection', () => {
    const one = withAnchor({}, 'a->b', { source: 'top' });
    expect(withAnchor(one, 'a->b', { target: 'left' })['a->b']).toEqual({
      source: 'top',
      target: 'left',
    });
    expect(withAnchor({}, 'a->b', {})).toEqual({});
    expect(withoutAnchor(one, 'a->b')).toEqual({});
    expect(withoutAnchor(one, 'x->y')).toBe(one);
  });

  it('takes a drop on the same nodes for new sides', () => {
    expect(
      reconnectOutcome(
        ordered,
        { ...ordered, sourceHandle: 'bottom', targetHandle: 'in' },
        draft,
        true,
      ),
    ).toEqual({ kind: 'sides', sides: { source: 'bottom' } });
    expect(reconnectOutcome(ordered, { ...ordered, sourceHandle: 'out' }, draft, true)).toBeNull();
  });

  it('moves the sides of a connection when the draft is only shown', () => {
    expect(reconnectOutcome(ordered, { ...ordered, targetHandle: 'top' }, draft, false)).toEqual({
      kind: 'sides',
      sides: { target: 'top' },
    });
  });

  it('moves the end of a return to an earlier step', () => {
    expect(
      reconnectOutcome(
        returning,
        { source: review, target: plan, targetHandle: 'left' },
        draft,
        true,
      ),
    ).toEqual({ kind: 'goto', source: review, target: plan, targetSide: 'left' });
  });

  it('refuses the end of a return moved forward, to another source or when it is only shown', () => {
    expect(reconnectOutcome(returning, { source: plan, target: review }, draft, true)).toBeNull();
    expect(reconnectOutcome(returning, { source: code, target: plan }, draft, true)).toBeNull();
    expect(reconnectOutcome(returning, { source: review, target: plan }, draft, false)).toBeNull();
  });

  it('does not change the goto of an edge of the order to another node', () => {
    expect(reconnectOutcome(ordered, { source: plan, target: review }, draft, true)).toBeNull();
  });

  it('keeps a chosen connection while it is shown', () => {
    const chosen = { kind: 'edge' as const, id: 'next:a->b' };
    expect(liveSelection(chosen, draft, null, new Set(['next:a->b']))).toBe(chosen);
    expect(liveSelection(chosen, draft, null, new Set(['next:b->c']))).toBeNull();
    expect(liveSelection(chosen, draft)).toBe(chosen);
  });
});

const RAW = {
  steps: [
    { id: 'plan', specialist: 'plan' },
    { id: 'code', specialist: 'coder' },
    { id: 'review', specialist: 'reviewer' },
  ],
};

function entry(id: string, overrides: Partial<EditorPipeline> = {}): EditorPipeline {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw: RAW,
    shared_tags: [] as string[],
    own_tags: [] as string[],
    ...overrides,
  };
  return { ...base, sources: overrides.sources ?? sourcesFor('pipelines', base) };
}

const specialists = ['plan', 'coder', 'reviewer', 'writer', 'scan', 'report'].map((slug) =>
  specialistEntry(slug),
);

const EXPLORE = {
  steps: [
    { id: 'scan', specialist: 'scan' },
    { id: 'report', specialist: 'report' },
  ],
};

const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

function api(overrides: Partial<Api> = {}): Api {
  return fakeApi({
    config: vi.fn(async () =>
      configView({
        specialists,
        pipelines: [entry('explore', { raw: EXPLORE }), entry('feature')],
        actions: [actionEntry('lint', { run: 'npm run lint' })],
      }),
    ),
    writePipeline: saved(),
    ...overrides,
  });
}

function Page({ start = 'explore' }: { start?: string }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <PipelinesPage api={api()} runs={[]} selected={selected} onSelect={setSelected} />;
}

const openDiagram = async () => {
  await screen.findAllByRole('listitem', { name: /^step \d+$/ });
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
};
const stepNodes = () => [...document.querySelectorAll<HTMLElement>('[data-kind="step"]')];
const titleOf = (item: HTMLElement) => item.querySelector('.font-medium')?.textContent;
const nodeOf = (id: string) => flow.props!.nodes.find((item) => item.id === id)!;
const keyOf = (title: string) =>
  stepNodes()
    .find((item) => titleOf(item) === title)!
    .dataset.testid!.replace('canvas-node-', '');
const place = (id: string) => nodeOf(id).position;
const inspector = () => within(screen.getByRole('complementary', { name: 'node properties' }));
const KEY = 'aip.web.canvasLayout./repo.explore';

/** What the flow does when a node is dragged and dropped. */
function drag(id: string, to: { x: number; y: number }) {
  act(() => flow.props!.onNodesChange!([{ type: 'position', id, position: to, dragging: false }]));
  act(() => flow.props!.onNodeDragStop!({}, { ...nodeOf(id), position: to }));
}

const noOverlaps = () => {
  const nodes = flow.props!.nodes.map((item) => ({ id: item.id, position: item.position }));
  for (const [index, one] of nodes.entries()) {
    for (const other of nodes.slice(index + 1)) expect(overlap(one, other)).toBe(false);
  }
};

describe('free layout of the diagram', () => {
  it('leaves a dropped node where it was dropped and the draft alone', async () => {
    render(<Page />);
    await openDiagram();
    drag(keyOf('report'), at(-100, 300));
    expect(place(keyOf('report'))).toEqual(at(-100, 300));
    expect(stepNodes().map(titleOf)).toEqual(['scan', 'report']);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).report).toEqual(at(-100, 300));
  });

  it('moves a node dropped on another off it', async () => {
    render(<Page />);
    await openDiagram();
    const scan = place(keyOf('scan'));
    drag(keyOf('report'), { ...scan });
    expect(place(keyOf('scan'))).toEqual(scan);
    expect(place(keyOf('report')).y).toBeGreaterThan(scan.y);
    noOverlaps();
  });

  it('keeps a moved node where it is when a step is added', async () => {
    render(<Page />);
    await openDiagram();
    const delivery = at(place('delivery').x, 400);
    drag('delivery', delivery);
    const before = Object.fromEntries(flow.props!.nodes.map((item) => [item.id, item.position]));
    const adds = screen.getAllByRole('button', { name: 'Add a step here' });
    fireEvent.click(adds[adds.length - 1]!);
    expect(stepNodes()).toHaveLength(3);
    expect(place('delivery')).toEqual(delivery);
    for (const item of flow.props!.nodes) {
      if (before[item.id]) expect(item.position).toEqual(before[item.id]);
    }
    noOverlaps();
  });

  it('puts a new step in the row when nothing was moved', async () => {
    render(<Page />);
    await openDiagram();
    const adds = screen.getAllByRole('button', { name: 'Add a step here' });
    fireEvent.click(adds[adds.length - 1]!);
    expect(stepNodes()).toHaveLength(3);
    expect(flow.props!.nodes.map((item) => item.position.y)).toEqual(
      flow.props!.nodes.map(() => 0),
    );
    const xs = flow.props!.nodes.map((item) => item.position.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('does not put a new step on the delivery that was moved to its place', async () => {
    render(<Page />);
    await openDiagram();
    const last = stepNodes().length - 1;
    const lastStep = flow.props!.nodes.filter((item) => item.id.startsWith('step:'))[last]!;
    const slot = at(lastStep.position.x + 240, lastStep.position.y);
    drag('delivery', slot);
    const moved = place('delivery');
    const adds = screen.getAllByRole('button', { name: 'Add a step here' });
    fireEvent.click(adds[adds.length - 1]!);
    expect(place('delivery')).toEqual(moved);
    noOverlaps();
  });

  it('keeps the place of a step when its specialist is changed', async () => {
    render(<Page start="feature" />);
    await openDiagram();
    const id = keyOf('code');
    drag(id, at(340, 220));
    fireEvent.click(stepNodes().find((item) => titleOf(item) === 'code')!);
    choose(inspector().getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    expect(place(id)).toEqual(at(340, 220));
  });

  it('lets a shared pipeline that is only shown be moved without touching the draft', async () => {
    const shared = entry('quick', { level: 'global', file: '/xdg/aip/pipelines/quick.yaml' });
    const onDirty = vi.fn();
    render(
      <PipelineForm
        api={api()}
        view={configView({ specialists, pipelines: [shared], actions: [] })}
        pipeline={shared}
        activeRuns={0}
        notice={null}
        onDirty={onDirty}
        onReload={async () => {}}
        onSaved={async () => {}}
        onDeleted={async () => {}}
        sharedOnly={undefined}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
    const id = keyOf('review');
    drag(id, at(60, 500));
    expect(place(id)).toEqual(at(60, 500));
    expect(stepNodes().map(titleOf)).toEqual(['plan', 'code', 'review']);
    expect(onDirty).not.toHaveBeenCalledWith(true);
  });

  it('puts the nodes back in the automatic layout with the button', async () => {
    render(<Page />);
    await openDiagram();
    const auto = Object.fromEntries(flow.props!.nodes.map((item) => [item.id, item.position]));
    drag(keyOf('scan'), at(7, 250));
    drag('delivery', at(900, 300));
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(Object.fromEntries(flow.props!.nodes.map((item) => [item.id, item.position]))).toEqual(
      auto,
    );
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await waitFor(() => expect(fitView).toHaveBeenCalled());
  });

  it('offers the button when the pipeline is only shown', async () => {
    const shared = entry('quick', { level: 'global', file: '/xdg/aip/pipelines/quick.yaml' });
    render(
      <PipelineForm
        api={api()}
        view={configView({ specialists, pipelines: [shared], actions: [] })}
        pipeline={shared}
        activeRuns={0}
        notice={null}
        onDirty={() => {}}
        onReload={async () => {}}
        onSaved={async () => {}}
        onDeleted={async () => {}}
        sharedOnly={undefined}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
    expect(screen.getByRole('button', { name: 'Arrange' })).toBeTruthy();
  });

  it('restores the layout after a reload, for its own pipeline only', async () => {
    const first = render(<Page />);
    await openDiagram();
    drag(keyOf('scan'), at(40, 260));
    first.unmount();
    render(<Page />);
    await openDiagram();
    expect(place(keyOf('scan'))).toEqual(at(40, 260));
    cleanup();
    render(<Page start="feature" />);
    await openDiagram();
    expect(flow.props!.nodes.every((item) => item.position.y === 0)).toBe(true);
  });
});

describe('the connections of the diagram', () => {
  /** The width a node has in the routes while it is not measured. */
  const ROUTE_WIDTH = 208;
  const ANCHORS = 'aip.web.canvasAnchors./repo.explore';
  const edgeOf = (id: string) => flow.props!.edges.find((item) => item.id === id)!;
  const routeOf = (id: string) =>
    (edgeOf(id).data as { route: { points: { x: number; y: number }[] } }).route;
  const order = () => `next:${keyOf('scan')}->${keyOf('report')}`;
  const reconnect = (sourceHandle: string | null, targetHandle: string | null = null) => {
    const edge = edgeOf(order());
    act(() =>
      flow.props!.onReconnect!(edge, {
        source: edge.source,
        target: edge.target,
        sourceHandle,
        targetHandle,
      }),
    );
  };

  it('marks a chosen connection and clears the mark with a click on the pane', async () => {
    render(<Page />);
    await openDiagram();
    const id = order();
    expect(screen.getByTestId(`edge-path-${id}`).dataset.selected).toBeUndefined();
    fireEvent.click(screen.getByTestId(`edge-${id}`));
    expect(screen.getByTestId(`edge-path-${id}`).dataset.selected).toBe('true');
    expect(inspector().getByTestId('inspector-edge').textContent).toContain('scan');
    fireEvent.click(screen.getByTestId('fake-pane'));
    expect(screen.getByTestId(`edge-path-${id}`).dataset.selected).toBeUndefined();
  });

  it('does not remove a connection of the order with Delete', async () => {
    render(<Page />);
    await openDiagram();
    fireEvent.click(screen.getByTestId(`edge-${order()}`));
    fireEvent.keyDown(screen.getByTestId('pipeline-canvas'), { key: 'Delete' });
    expect(stepNodes().map(titleOf)).toEqual(['scan', 'report']);
    expect(screen.getByTestId(`edge-${order()}`)).toBeTruthy();
  });

  it('moves the start of a connection to another side, remembers it and gives it back', async () => {
    const onDirty = vi.fn();
    const explore = entry('explore', { raw: EXPLORE });
    const first = render(
      <PipelineForm
        api={api()}
        view={configView({ specialists, pipelines: [explore], actions: [] })}
        pipeline={explore}
        activeRuns={0}
        notice={null}
        onDirty={onDirty}
        onReload={async () => {}}
        onSaved={async () => {}}
        onDeleted={async () => {}}
        sharedOnly={undefined}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
    const scan = place(keyOf('scan'));
    reconnect('bottom');
    expect(routeOf(order()).points[0]).toEqual({ x: scan.x + ROUTE_WIDTH / 2, y: scan.y + 90 });
    expect(JSON.parse(window.localStorage.getItem(ANCHORS)!)).toEqual({
      'scan->report': { source: 'bottom' },
    });
    // the draft is not touched
    expect(onDirty).not.toHaveBeenCalledWith(true);
    first.unmount();
    render(<Page />);
    await openDiagram();
    expect(routeOf(order()).points[0]!.y).toBe(place(keyOf('scan')).y + 90);
    fireEvent.click(screen.getByTestId(`edge-${order()}`));
    fireEvent.click(inspector().getByRole('button', { name: 'Reset the points' }));
    expect(routeOf(order()).points[0]).toEqual({
      x: place(keyOf('scan')).x + ROUTE_WIDTH,
      y: place(keyOf('scan')).y + 45,
    });
  });

  it('forgets the sides with the layout when the nodes are arranged', async () => {
    render(<Page />);
    await openDiagram();
    reconnect('bottom');
    expect(window.localStorage.getItem(ANCHORS)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(window.localStorage.getItem(ANCHORS)).toBeNull();
    expect(routeOf(order()).points[0]!.x).toBe(place(keyOf('scan')).x + ROUTE_WIDTH);
  });

  it('moves the end of a return to another step and keeps the side of the new end', async () => {
    render(<Page start="feature" />);
    await openDiagram();
    const [plan, code, review] = ['plan', 'code', 'review'].map(keyOf) as [string, string, string];
    act(() => flow.props!.onConnect!({ source: review, target: code }));
    const old = edgeOf(`return:${review.replace('step:', '')}`);
    expect(old.target).toBe(code);
    act(() =>
      flow.props!.onReconnect!(old, { source: review, target: plan, targetHandle: 'left' }),
    );
    expect(edgeOf(old.id).target).toBe(plan);
    expect(JSON.parse(window.localStorage.getItem('aip.web.canvasAnchors./repo.feature')!)).toEqual(
      {
        'return:review->plan': { target: 'left' },
      },
    );
  });

  it('leaves a return where it is when its end is dropped on a later step', async () => {
    render(<Page start="feature" />);
    await openDiagram();
    const [plan, code, review] = ['plan', 'code', 'review'].map(keyOf) as [string, string, string];
    act(() => flow.props!.onConnect!({ source: review, target: code }));
    const old = edgeOf(`return:${review.replace('step:', '')}`);
    act(() => flow.props!.onReconnect!(old, { source: plan, target: review }));
    expect(edgeOf(old.id).target).toBe(code);
  });

  it('allows a connection between nodes that are already joined, and a return to an earlier step', async () => {
    render(<Page start="feature" />);
    await openDiagram();
    const [plan, code, review] = ['plan', 'code', 'review'].map(keyOf) as [string, string, string];
    const valid = flow.props!.isValidConnection!;
    expect(valid({ source: plan, target: code })).toBe(true);
    expect(valid({ source: review, target: plan })).toBe(true);
    expect(valid({ source: plan, target: review })).toBe(false);
  });
});

describe('the background of the frames', () => {
  it('gives the points and the split on the form a card background', async () => {
    render(<Page />);
    await screen.findAllByRole('listitem', { name: /^step \d+$/ });
    const points = screen.getAllByTestId('pipeline-points');
    expect(points.length).toBeGreaterThan(0);
    for (const item of points) expect(item.classList.contains('bg-card')).toBe(true);
    for (const item of document.querySelectorAll('fieldset.rounded-lg')) {
      expect(item.classList.contains('bg-card')).toBe(true);
    }
  });

  it('puts the step of the inspector on a card and leaves the points on their own frame', async () => {
    render(<Page />);
    await openDiagram();
    fireEvent.click(stepNodes().find((item) => titleOf(item) === 'scan')!);
    expect(inspector().getByTestId('inspector-step-id').closest('.bg-card')).not.toBeNull();
    fireEvent.click(screen.getByTestId('canvas-node-point:before_delivery'));
    const aside = screen.getByRole('complementary', { name: 'node properties' });
    const frame = aside.firstElementChild!;
    expect(frame.getAttribute('data-testid')).toBe('pipeline-points');
    expect(frame.classList.contains('bg-card')).toBe(true);
  });
});
