// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import { PipelineForm } from '../src/features/pipelines/index.ts';
import { isRemoveKey } from '../src/features/pipelines/form/canvas/canvasKeys.ts';
import type { EditorPipeline, FieldError } from '../src/shared/api/types.ts';

import { act, choose, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { flow } from './fakeFlow.tsx';
import {
  actionEntry,
  configView,
  fakeApi,
  pipelineOf,
  sourcesFor,
  specialistEntry,
} from './fixtures.ts';

vi.mock('@xyflow/react', async () => (await import('./fakeFlow.tsx')).fakeFlow());

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RAW = {
  steps: [
    { id: 'plan', specialist: 'plan' },
    { id: 'code', specialist: 'coder', on_reject: { goto: 'plan', max_rounds: 2 } },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
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

const specialists = ['plan', 'coder', 'reviewer', 'writer'].map((slug) => specialistEntry(slug));
const lint = actionEntry('lint', { run: 'npm run lint' });

const saved = () => vi.fn(async () => ({ ok: true as const, revision: 'r', file: '/f' }));

function api(overrides: Partial<Api> = {}, pipelines = [entry('feature')]): Api {
  return fakeApi({
    config: vi.fn(async () => configView({ specialists, pipelines, actions: [lint] })),
    writePipeline: saved(),
    ...overrides,
  });
}

function Page({ api, start = 'feature' }: { api: Api; start?: string }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <PipelinesPage api={api} runs={[]} selected={selected} onSelect={setSelected} />;
}

const openTab = (name: RegExp) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
const openDiagram = async () => {
  await screen.findAllByRole('listitem', { name: /^step \d+$/ });
  openTab(/Diagram/);
};
const canvas = () => screen.getByTestId('pipeline-canvas');
const stepNodes = () => [...document.querySelectorAll<HTMLElement>('[data-kind="step"]')];
const titleOf = (node: HTMLElement) => node.querySelector('.font-medium')?.textContent;
const node = (title: string) => stepNodes().find((item) => titleOf(item) === title)!;
const keyOf = (title: string) => node(title).dataset.testid!.replace('canvas-node-step:', '');
const inspector = () => within(screen.getByRole('complementary', { name: 'node properties' }));
const written = (writePipeline: ReturnType<typeof saved>) =>
  (writePipeline.mock.calls.at(-1) as unknown as [string, { steps: Record<string, unknown>[] }])[1];
const save = async (writePipeline: ReturnType<typeof saved>) => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(writePipeline).toHaveBeenCalled());
  return written(writePipeline);
};

describe('the inspector', () => {
  it('opens for a chosen node and changes the draft and the written file', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    expect(inspector().getByText(/^Choose a node to edit it\./)).toBeTruthy();
    fireEvent.click(node('code'));
    expect(inspector().getByTestId('inspector-step-id').textContent).toBe('code');
    fireEvent.change(inspector().getByLabelText('additional step prompt'), {
      target: { value: 'be careful' },
    });
    fireEvent.click(inspector().getByRole('switch', { name: 'Human review' }));
    const value = await save(writePipeline);
    expect(value.steps[1]).toMatchObject({
      id: 'code',
      additional_prompt: 'be careful',
      human_review: true,
      on_reject: { goto: 'plan', max_rounds: 2 },
    });
  });

  it('renames a node by the specialist and keeps the returns that point to it', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    const before = keyOf('plan');
    fireEvent.click(node('plan'));
    choose(inspector().getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    expect(titleOf(node('writer'))).toBe('writer');
    expect(keyOf('writer')).toBe(before);
    const value = await save(writePipeline);
    expect(value.steps[0]).toMatchObject({ id: 'writer', specialist: 'writer' });
    expect(value.steps[1]).toMatchObject({ on_reject: { goto: 'writer', max_rounds: 2 } });
  });

  it('offers the specialists as «Name (slug)» and keeps an unknown one as its slug', async () => {
    const raw = { steps: [{ id: 'ghost', specialist: 'ghost' }, ...RAW.steps.slice(1)] };
    render(<Page api={api({}, [entry('feature', { raw })])} />);
    await openDiagram();
    fireEvent.click(node('ghost'));
    const select = inspector().getByRole('combobox', { name: 'step specialist' });
    expect(select.textContent).toBe('ghost');
    fireEvent.keyDown(select, { key: 'Enter' });
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('REVIEWER (reviewer)');
    expect(options).toContain('ghost');
  });

  it('shows the edge of a return with its rounds', async () => {
    render(<Page api={api()} />);
    await openDiagram();
    const edge = screen.getByTestId(`edge-return:${keyOf('review')}`);
    expect(edge.textContent).toBe('≤ 3');
    const shown = flow.props!.edges.find((item) => item.id === `return:${keyOf('review')}`) as {
      type?: string;
      data?: { route?: { points: unknown[] } };
    };
    expect(shown.type).toBe('orthogonal');
    expect(shown.data?.route?.points.length).toBeGreaterThan(1);
    fireEvent.click(edge);
    fireEvent.click(inspector().getByRole('button', { name: 'Remove the return' }));
    expect(screen.queryByTestId(`edge-return:${keyOf('review')}`)).toBeNull();
  });
});

describe('adding, removing and moving', () => {
  it('adds a step on an edge, chooses it and writes it in place', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    expect(screen.getAllByRole('button', { name: 'Add a step here' })).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a step here' })[1]!);
    expect(stepNodes()).toHaveLength(4);
    choose(inspector().getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    const value = await save(writePipeline);
    expect(value.steps.map((step) => step.id)).toEqual(['plan', 'writer', 'code', 'review']);
  });

  it('adds a step at the end', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a step here' })[3]!);
    choose(inspector().getByRole('combobox', { name: 'step specialist' }), /\(writer\)/);
    expect((await save(writePipeline)).steps.map((step) => step.id)).toEqual([
      'plan',
      'code',
      'review',
      'writer',
    ]);
  });

  it('removes the chosen step with Delete and clears the returns to it', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    fireEvent.click(node('plan'));
    fireEvent.keyDown(canvas(), { key: 'Delete' });
    expect(stepNodes().map(titleOf)).toEqual(['code', 'review']);
    const value = await save(writePipeline);
    expect(value.steps).toEqual([
      { id: 'code', specialist: 'coder' },
      { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
    ]);
  });

  it('removes a step with the button of the inspector', async () => {
    render(<Page api={api()} />);
    await openDiagram();
    fireEvent.click(node('code'));
    fireEvent.click(inspector().getByRole('button', { name: 'delete step' }));
    expect(stepNodes().map(titleOf)).toEqual(['plan', 'review']);
  });

  it('does not take Delete and Backspace meant for a field', async () => {
    render(<Page api={api()} />);
    await openDiagram();
    fireEvent.click(node('code'));
    const field = inspector().getByLabelText('additional step prompt');
    fireEvent.keyDown(field, { key: 'Delete' });
    fireEvent.keyDown(field, { key: 'Backspace' });
    expect(stepNodes()).toHaveLength(3);
    expect(isRemoveKey({ key: 'Delete', target: field })).toBe(false);
    expect(isRemoveKey({ key: 'Backspace', target: document.createElement('input') })).toBe(false);
    expect(isRemoveKey({ key: 'Backspace', target: canvas() })).toBe(true);
    expect(isRemoveKey({ key: 'a', target: canvas() })).toBe(false);
  });

  it('moves a step with the buttons of the inspector', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    fireEvent.click(node('review'));
    fireEvent.click(inspector().getByRole('button', { name: 'up' }));
    expect(stepNodes().map(titleOf)).toEqual(['plan', 'review', 'code']);
    expect((await save(writePipeline)).steps.map((step) => step.id)).toEqual([
      'plan',
      'review',
      'code',
    ]);
  });

  it('does not change the order of the steps when a node is dragged', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    const review = flow.props!.nodes.find((item) => item.id === `step:${keyOf('review')}`)!;
    act(() => flow.props!.onNodeDragStop!({}, { ...review, position: { x: -10, y: 300 } }));
    expect(stepNodes().map(titleOf)).toEqual(['plan', 'code', 'review']);
    expect((await save(writePipeline)).steps.map((step) => step.id)).toEqual([
      'plan',
      'code',
      'review',
    ]);
  });
});

describe('returns by connecting', () => {
  it('sets a return to an earlier step and refuses a later one', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    expect((flow.props as { connectionLineType?: unknown }).connectionLineType).toBe('smoothstep');
    const connect = flow.props!.onConnect!;
    const [plan, review] = ['plan', 'review'].map((title) => `step:${keyOf(title)}`);
    const valid = flow.props!.isValidConnection!;
    expect(valid({ source: review!, target: plan! })).toBe(true);
    expect(valid({ source: plan!, target: review! })).toBe(false);
    act(() => connect({ source: plan!, target: review! }));
    expect(screen.queryByTestId(`edge-return:${keyOf('plan')}`)).toBeNull();
    act(() => connect({ source: review!, target: plan! }));
    const value = await save(writePipeline);
    expect(value.steps[2]).toMatchObject({ on_reject: { goto: 'plan', max_rounds: 3 } });
  });
});

describe('split and points', () => {
  it('turns the split on from the start node and adds the nodes of its points', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    expect(screen.queryByTestId('canvas-node-split')).toBeNull();
    fireEvent.click(screen.getByTestId('canvas-node-start'));
    fireEvent.click(inspector().getByRole('switch', { name: 'Task split' }));
    expect(screen.getByTestId('canvas-node-split')).toBeTruthy();
    expect(screen.getByTestId('canvas-node-point:before_split')).toBeTruthy();
    choose(inspector().getByRole('combobox', { name: 'split specialist' }), /\(plan\)/);
    const value = await save(writePipeline);
    expect((value as { split?: unknown }).split).toEqual({ specialist: 'plan' });
  });

  it('edits the list of one point from its node', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline })} />);
    await openDiagram();
    await waitFor(() =>
      expect(screen.getByTestId('canvas-node-point:before_delivery').textContent).toContain(
        '0 actions',
      ),
    );
    fireEvent.click(screen.getByTestId('canvas-node-point:before_delivery'));
    expect(inspector().queryByRole('group', { name: 'After delivery' })).toBeNull();
    choose(
      await inspector().findByRole('combobox', { name: 'add an action: Before delivery' }),
      'lint',
    );
    expect(screen.getByTestId('canvas-node-point:before_delivery').textContent).toContain(
      '1 action',
    );
    expect(((await save(writePipeline)) as { stages?: unknown }).stages).toEqual({
      before_delivery: ['lint'],
    });
  });
});

describe('errors of the check', () => {
  const answer = (errors: FieldError[]) => vi.fn(async () => ({ topology: pipelineOf(), errors }));

  it('marks the node of the step and shows the error in the inspector', async () => {
    const previewPipeline = answer([
      { path: 'swarm.pipelines.feature.steps[1].specialist', message: 'unknown specialist `x`' },
    ]);
    render(<Page api={api({ previewPipeline })} />);
    await openDiagram();
    await waitFor(() => expect(node('code').dataset.error).toBe('true'));
    expect(node('plan').dataset.error).toBeUndefined();
    fireEvent.click(node('code'));
    expect(inspector().getByRole('alert').textContent).toContain('unknown specialist');
  });

  it('marks the split node by an error of the split', async () => {
    const raw = { split: { specialist: 'plan' }, steps: RAW.steps };
    const previewPipeline = answer([
      { path: 'swarm.pipelines.feature.split.specialist', message: 'unknown specialist' },
    ]);
    render(<Page api={api({ previewPipeline }, [entry('feature', { raw })])} />);
    await openDiagram();
    await waitFor(() => expect(screen.getByTestId('canvas-node-split').dataset.error).toBe('true'));
    expect(stepNodes().every((item) => item.dataset.error === undefined)).toBe(true);
  });
});

describe('a split that follows another pipeline', () => {
  const raw = { split: { specialist: 'plan', pipeline: 'epic' }, steps: RAW.steps };
  const pipelines = () => [
    entry('feature', { raw }),
    entry('epic', {
      raw: {
        steps: [
          { id: 'a', specialist: 'plan' },
          { id: 'b', specialist: 'coder' },
        ],
      },
    }),
  ];

  it('shows the steps of the other pipeline locked', async () => {
    const writePipeline = saved();
    render(<Page api={api({ writePipeline }, pipelines())} />);
    await screen.findByLabelText('Task split');
    openTab(/Diagram/);
    const follow = [...document.querySelectorAll<HTMLElement>('[data-kind="follow"]')];
    expect(follow).toHaveLength(2);
    expect(follow.every((item) => item.dataset.locked === 'true')).toBe(true);
    expect(stepNodes()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Add a step here' })).toBeNull();
    expect(flow.props!.nodesDraggable).toBe(true);
    expect(flow.props!.nodesConnectable).toBe(false);
    fireEvent.click(follow[0]!);
    expect(inspector().getByText(/edit them there/)).toBeTruthy();
    fireEvent.keyDown(canvas(), { key: 'Delete' });
    expect(document.querySelectorAll('[data-kind="follow"]')).toHaveLength(2);
    const value = await save(writePipeline);
    expect(value.steps).toBeUndefined();
  });

  it('marks a missing target pipeline', async () => {
    render(<Page api={api({}, [entry('feature', { raw })])} />);
    await screen.findByLabelText('Task split');
    openTab(/Diagram/);
    const missing = document.querySelector<HTMLElement>('[data-kind="follow"]')!;
    expect(missing.dataset.error).toBe('true');
    expect(missing.textContent).toContain('epic');
  });
});

describe('the form and the diagram share one draft', () => {
  it('shows an edit of either tab on the other', async () => {
    render(<Page api={api()} />);
    await openDiagram();
    fireEvent.click(node('review'));
    fireEvent.change(inspector().getByLabelText('additional step prompt'), {
      target: { value: 'from the diagram' },
    });
    openTab(/^Form/);
    const cards = await screen.findAllByRole('listitem', { name: /^step \d+$/ });
    const prompt = within(cards[2]!).getByLabelText(
      'additional step prompt',
    ) as HTMLTextAreaElement;
    expect(prompt.value).toBe('from the diagram');
    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'delete step' }));
    fireEvent.change(prompt, { target: { value: 'from the form' } });
    openTab(/Diagram/);
    expect(stepNodes().map(titleOf)).toEqual(['code', 'review']);
    fireEvent.click(node('review'));
    expect(
      (inspector().getByLabelText('additional step prompt') as HTMLTextAreaElement).value,
    ).toBe('from the form');
  });
});

describe('view only', () => {
  const sharedEntry = () =>
    entry('quick', { level: 'global', file: '/xdg/aip/pipelines/quick.yaml' });
  const form = (over: Partial<Parameters<typeof PipelineForm>[0]> = {}) => {
    const onDirty = vi.fn();
    const props = {
      api: api({}, [sharedEntry()]),
      view: configView({ specialists, pipelines: [sharedEntry()], actions: [lint] }),
      pipeline: sharedEntry(),
      activeRuns: 0,
      notice: null,
      onDirty,
      onReload: async () => {},
      onSaved: async () => {},
      onDeleted: async () => {},
      ...over,
    };
    render(<PipelineForm {...props} />);
    return { onDirty, props };
  };

  it('forbids every edit of a shared pipeline on the project page', async () => {
    const { onDirty } = form();
    openTab(/Diagram/);
    expect(screen.queryByRole('button', { name: 'Add a step here' })).toBeNull();
    expect(flow.props!.nodesDraggable).toBe(true);
    expect(flow.props!.nodesConnectable).toBe(false);
    fireEvent.click(node('code'));
    expect(inspector().getByLabelText('additional step prompt')).toHaveProperty('disabled', true);
    expect(inspector().getByRole('button', { name: 'delete step' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.keyDown(canvas(), { key: 'Delete' });
    fireEvent.click(screen.getByTestId('canvas-node-start'));
    expect(inspector().getByRole('switch', { name: 'Task split' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(stepNodes()).toHaveLength(3);
    expect(onDirty).not.toHaveBeenCalledWith(true);
  });

  it('ignores a return dragged between the nodes when only shown', async () => {
    const { onDirty } = form();
    openTab(/Diagram/);
    const [plan, review] = ['plan', 'review'].map((title) => `step:${keyOf(title)}`);
    const connection = { source: review!, target: plan! };
    expect(flow.props!.isValidConnection!(connection)).toBe(false);
    act(() => flow.props!.onConnect!(connection));
    // review already returns to code; the dragged link to plan must not replace it
    expect(screen.getByTestId(`edge-return:${keyOf('review')}`).textContent).toBe('≤ 3');
    expect(onDirty).not.toHaveBeenCalledWith(true);
  });

  it('edits a shared pipeline in the settings, and not while it is being saved', async () => {
    let finish: (value: { ok: true; revision: string; file: string }) => void = () => {};
    const writePipeline = vi.fn(
      () =>
        new Promise<{ ok: true; revision: string; file: string }>((resolve) => (finish = resolve)),
    );
    const { onDirty } = form({
      api: api({ writePipeline }, [sharedEntry()]),
      sharedOnly: { usage: null, usageError: null, onUsageStale: () => {} },
    });
    openTab(/Diagram/);
    expect(screen.getAllByRole('button', { name: 'Add a step here' })).toHaveLength(4);
    fireEvent.click(node('plan'));
    fireEvent.keyDown(canvas(), { key: 'Delete' });
    expect(stepNodes()).toHaveLength(2);
    await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writePipeline).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add a step here' })).toBeNull(),
    );
    fireEvent.click(node('code'));
    fireEvent.keyDown(canvas(), { key: 'Delete' });
    expect(stepNodes()).toHaveLength(2);
    await act(async () => finish({ ok: true, revision: 'r', file: '/f' }));
  });
});
