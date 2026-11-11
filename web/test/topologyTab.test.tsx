// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import {
  configView,
  fakeApi,
  openFake,
  pipelineOf,
  pipelinesView,
  sourcesFor,
  specialistEntry,
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

const RAW = {
  steps: [
    { id: 'plan', specialist: 'coder' },
    { id: 'code', specialist: 'coder' },
  ],
};

function pipelineEntry(id: string) {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw: RAW,
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
}

const IDS = ['feature', 'epic'];

function api(ids = IDS) {
  return fakeApi({
    config: vi.fn(async () =>
      configView({
        specialists: [specialistEntry('coder')],
        pipelines: ids.map((id) => pipelineEntry(id)),
      }),
    ),
    pipelines: vi.fn(async () => pipelinesView({ pipelines: ids.map((id) => pipelineOf({ id })) })),
  });
}

const tabs = () => within(screen.getByRole('tablist', { name: 'Pipeline sections' }));
const tab = (name: string) => tabs().getByRole('tab', { name });
const selectedTab = () =>
  tabs()
    .getAllByRole('tab')
    .filter((candidate) => candidate.getAttribute('aria-selected') === 'true')
    .map((candidate) => candidate.textContent);

describe('the tab «Topology» of the page «Pipeline»', () => {
  it('is the last of four tabs and shows the graph without the lists of the pipelines', async () => {
    window.location.hash = '#pipelines/topology/feature';
    render(<App api={api()} openStream={openFake} />);
    await screen.findByTestId('stage-review');
    expect(
      tabs()
        .getAllByRole('tab')
        .map((item) => item.textContent),
    ).toEqual(['Pipelines', 'Actions', 'System stages', 'Topology']);
    expect(selectedTab()).toEqual(['Topology']);
    expect(screen.queryByRole('button', { name: 'New pipeline' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Import/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
  });

  it('selects a pipeline in the list and keeps the tab', async () => {
    window.location.hash = '#pipelines/topology/feature';
    render(<App api={api()} openStream={openFake} />);
    await screen.findByTestId('stage-review');
    const list = await screen.findByRole('list', { name: 'pipeline' });
    fireEvent.click(within(list).getByRole('button', { name: /epic/ }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/epic'));
    expect(selectedTab()).toEqual(['Topology']);
  });

  it('opens the pipeline of the tab «Pipelines» and edits it from there', async () => {
    window.location.hash = '#pipelines/epic';
    render(<App api={api()} openStream={openFake} />);
    await waitFor(() => expect(tab('Topology').getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(tab('Topology'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/epic'));
    fireEvent.click(await screen.findByRole('link', { name: 'Edit' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/epic'));
    expect(selectedTab()).toEqual(['Pipelines']);
  });

  it('returns to the last pipeline opened on the tab, not the one of «Pipelines»', async () => {
    window.location.hash = '#pipelines/topology/epic';
    render(<App api={api()} openStream={openFake} />);
    await screen.findByTestId('stage-review');
    fireEvent.click(tab('Pipelines'));
    await waitFor(() => expect(selectedTab()).toEqual(['Pipelines']));
    const list = await screen.findByRole('list', { name: 'pipeline' });
    fireEvent.click(within(list).getByText('feature'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/feature'));
    fireEvent.click(tab('Topology'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/epic'));
  });

  it('asks before leaving a form with unsaved edits and stays on «Stay»', async () => {
    window.location.hash = '#pipelines/feature';
    render(<App api={api()} openStream={openFake} />);
    const steps = await screen.findAllByRole('listitem', { name: /^step \d+$/ });
    fireEvent.change(steps[0]!.querySelector('textarea[aria-label="additional step prompt"]')!, {
      target: { value: 'analysis' },
    });
    fireEvent.click(tab('Topology'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(window.location.hash).toBe('#pipelines/feature');
    expect(selectedTab()).toEqual(['Pipelines']);
    fireEvent.click(tab('Topology'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/feature'));
    expect(selectedTab()).toEqual(['Topology']);
  });

  it('opens the first pipeline from the bare tab address', async () => {
    window.location.hash = '#pipelines';
    render(<App api={api()} openStream={openFake} />);
    await waitFor(() => expect(tab('Topology').getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(tab('Topology'));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/feature'));
  });

  it('is disabled while there is no pipeline', async () => {
    window.location.hash = '#pipelines';
    const empty = api([]);
    render(<App api={empty} openStream={openFake} />);
    await waitFor(() => expect(empty.config).toHaveBeenCalled());
    await screen.findByRole('list', { name: 'pipeline' });
    expect(tab('Topology').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(tab('Topology'));
    expect(window.location.hash).toBe('#pipelines');
  });
});

describe('the former addresses of the topology', () => {
  it('open the tab and replace the address without a new history entry', async () => {
    window.location.hash = '#topology/epic';
    const before = window.history.length;
    render(<App api={api()} openStream={openFake} />);
    await screen.findByTestId('stage-review');
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/epic'));
    expect(window.history.length).toBe(before);
    expect(selectedTab()).toEqual(['Topology']);
    expect(screen.getByRole('link', { name: 'Pipeline' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('lead from the bare address to the first pipeline', async () => {
    // as on loading the page: assigning the hash would fire a late event after the rewrite
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.history.replaceState(null, '', '#topology');
    render(<App api={api()} openStream={openFake} />);
    await waitFor(() => expect(window.location.hash).toBe('#pipelines/topology/feature'));
    expect(selectedTab()).toEqual(['Topology']);
  });
});

describe('the sections of the panel', () => {
  it('have no section «Topology» in the navigation and the palette', async () => {
    render(<App api={api()} openStream={openFake} />);
    const nav = screen.getByRole('navigation', { name: 'sections' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(within(nav).queryByRole('link', { name: 'Topology' })).toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });
    const palette = await screen.findByRole('dialog');
    expect(within(palette).queryByText('Topology')).toBeNull();
  });
});
