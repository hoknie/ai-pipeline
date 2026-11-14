// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import TopologyPage from '../src/features/topology/TopologyPage.tsx';
import { liveState } from '../src/features/topology/liveState.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import {
  configView,
  fakeApi,
  openFake,
  pipelineOf,
  pipelinesView,
  runView,
  sourcesFor,
  specialistEntry,
  topologyOf,
  variantOf,
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

const task = () => {
  const base = pipelineOf({ id: 'task' });
  return pipelineOf({
    id: 'task',
    steps: base.steps,
    variants: [
      variantOf(base.steps, 'default'),
      variantOf(base.steps, 'light', 'Лёгкая', ['review']),
    ],
  });
};

/** A run of the variant with its group on the step. */
function runOf(id: string, variant: string, step: string) {
  const topology = topologyOf();
  topology.steps = topology.steps.map((item) => ({
    ...item,
    groups: item.id === step ? [{ slug: `g-${id}`, title: `group ${id}`, status: 'running' }] : [],
  }));
  return runView({ id, title: `run ${id}`, pipeline: 'task', variant, topology });
}

function Page({ runs }: { runs: ReturnType<typeof runOf>[] }) {
  const [variant, setVariant] = useState<string | null>(null);
  const api = fakeApi({ pipelines: vi.fn(async () => pipelinesView({ pipelines: [task()] })) });
  return (
    <TopologyPage
      api={api}
      runs={runs}
      pipeline="task"
      variant={variant}
      onSelectVariant={setVariant}
      onSelectPipeline={vi.fn()}
      onOpenGroup={vi.fn()}
    />
  );
}

describe('the address of the topology of a variant', () => {
  it('reads and writes the variant', () => {
    const route = {
      view: 'pipelines',
      run: 'task',
      group: 'topology',
      step: 'light',
      tab: null,
    } as const;
    expect(parseRoute('#pipelines/topology/task/light')).toEqual(route);
    expect(formatRoute(route)).toBe('#pipelines/topology/task/light');
    expect(formatRoute({ ...route, step: null })).toBe('#pipelines/topology/task');
    expect(parseRoute('#pipelines/topology/task').step).toBeNull();
  });
});

describe('liveState of a variant', () => {
  it('counts only the runs of the variant, and all of them without one', () => {
    const runs = [runOf('a', 'default', 'plan'), runOf('b', 'light', 'code')];
    expect(liveState(task(), runs, '/repo').runs).toBe(2);
    expect(liveState(task(), runs, '/repo', 'light').runIds).toEqual(['b']);
  });
});

describe('the topology of a variant', () => {
  it('marks the skipped steps and shows only the groups of the runs of the variant', async () => {
    const runs = [runOf('a', 'default', 'plan'), runOf('b', 'light', 'code')];
    render(<Page runs={runs} />);
    const choice = await screen.findByRole('radiogroup', { name: 'Variant' });
    const items = within(choice).getAllByRole('radio');
    expect(items.map((item) => item.textContent)).toEqual([
      'default active: 1',
      'Лёгкая active: 1',
    ]);
    expect((await screen.findByTestId('stage-plan')).textContent).toContain('group a');
    fireEvent.click(within(choice).getByRole('radio', { name: /Лёгкая/ }));
    await waitFor(() => expect(screen.getByTestId('stage-review').dataset.skipped).toBe('true'));
    expect(screen.getByTestId('stage-code').textContent).toContain('group b');
    expect(screen.getByTestId('stage-plan').textContent).not.toContain('group a');
  });

  it('has no choice for a pipeline without variants', async () => {
    const api = fakeApi({ pipelines: vi.fn(async () => pipelinesView()) });
    render(
      <TopologyPage
        api={api}
        runs={[]}
        pipeline="feature"
        onSelectPipeline={vi.fn()}
        onOpenGroup={vi.fn()}
      />,
    );
    await screen.findByTestId('stage-review');
    expect(screen.queryByRole('radiogroup', { name: 'Variant' })).toBeNull();
  });
});

describe('the address of a variant in the panel', () => {
  const entry = (id: string) => {
    const base = {
      id,
      level: 'project' as const,
      file: `/repo/aip/pipelines/${id}.yaml`,
      revision: `rev-${id}`,
      raw: { steps: [{ id: 'plan', specialist: 'coder' }] },
      shared_tags: [] as string[],
      own_tags: [] as string[],
    };
    return { ...base, sources: sourcesFor('pipelines', base) };
  };
  const api = () =>
    fakeApi({
      config: vi.fn(async () =>
        configView({ specialists: [specialistEntry('coder')], pipelines: [entry('task')] }),
      ),
      pipelines: vi.fn(async () => pipelinesView({ pipelines: [task()] })),
    });

  it('selects the variant of the address and writes the choice to it', async () => {
    window.location.hash = '#pipelines/topology/task/light';
    render(<App api={api()} openStream={openFake} />);
    const choice = await screen.findByRole('radiogroup', { name: 'Variant' });
    expect(
      within(choice)
        .getByRole('radio', { name: /Лёгкая/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect((await screen.findByTestId('stage-review')).dataset.skipped).toBe('true');
    fireEvent.click(within(choice).getByRole('radio', { name: /default/ }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/task'));
  });

  it('replaces an unknown variant with the address of default', async () => {
    window.location.hash = '#pipelines/topology/task/nope';
    const before = window.history.length;
    render(<App api={api()} openStream={openFake} />);
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/task'));
    const choice = await screen.findByRole('radiogroup', { name: 'Variant' });
    expect(
      within(choice)
        .getByRole('radio', { name: /default/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(window.history.length).toBe(before);
  });
});
