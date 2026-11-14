// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { EditorPipeline, SharedPipelineView } from '../src/shared/api/types.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, openFake, queueOf, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('../src/features/topology/PipelineGraph.tsx', () => ({
  PipelineGraph: () => <div data-testid="graph" />,
}));

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STEPS = [{ id: 'code', specialist: 'coder' }];

const shared = (id: string, raw: Record<string, unknown> = { steps: STEPS }): EditorPipeline => {
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : [];
  const base = {
    id,
    level: 'global' as const,
    file: `/xdg/aip/pipelines/${id}.yaml`,
    revision: `g-${id}`,
    raw,
    shared_tags: tags,
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
};

const project = (id: string): EditorPipeline => {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `p-${id}`,
    raw: { steps: STEPS },
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
};

const usageOf = (id: string, overrides: Partial<SharedPipelineView> = {}): SharedPipelineView => ({
  id,
  name: null,
  tags: [],
  file: `/xdg/aip/pipelines/${id}.yaml`,
  revision: `g-${id}`,
  global: [],
  projects: [],
  ...overrides,
});

const view = () =>
  configView({
    specialists: [
      specialistEntry('coder', { level: 'global' }, { name: 'coder' }),
      specialistEntry('local', {}, { name: 'local' }),
    ],
    pipelines: [
      project('feature'),
      shared('quick', { name: 'Quick', tags: ['fast'], steps: STEPS }),
      shared('explore'),
    ],
  });

function show(overrides: Partial<Api> = {}, hash = '#settings/global/pipelines') {
  window.location.hash = hash;
  const api = fakeApi({
    queue: vi.fn(async () => queueOf()),
    config: vi.fn(async () => view()),
    sharedPipelines: vi.fn(async () => ({
      directory: '/xdg/aip/pipelines',
      pipelines: [
        usageOf('quick', {
          projects: [{ repository: '/work/app', references: [{ pipeline: 'epic', split: true }] }],
          global: [{ pipeline: 'other', split: true }],
        }),
        usageOf('explore'),
      ],
    })),
    ...overrides,
  });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const list = async () => within(await screen.findByRole('list', { name: 'Shared pipelines' }));

describe('shared pipelines group', () => {
  it('lists only pipelines with a shared file and shows the shared directory', async () => {
    show();
    const entries = await list();
    expect(entries.getAllByRole('button')).toHaveLength(2);
    expect(entries.queryByText('feature')).toBeNull();
    expect(entries.getByText('Quick')).toBeTruthy();
    expect(entries.getByText('fast')).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Where the settings are saved' });
    expect(within(region).getByText('/xdg/aip/pipelines')).toBeTruthy();
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('searches by id, name and tag and shows the empty states', async () => {
    show();
    const entries = await list();
    const search = screen.getByRole('searchbox', { name: 'Search by id, name or tag' });
    fireEvent.change(search, { target: { value: 'FAST' } });
    expect(entries.getAllByRole('button')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('shows the empty state without shared pipelines', async () => {
    show({ config: vi.fn(async () => configView({ pipelines: [project('feature')] })) });
    expect(await screen.findByText('No shared pipelines yet')).toBeTruthy();
  });

  it('changes the address when a pipeline is chosen and opens it from the address', async () => {
    show();
    fireEvent.click((await (await list()).findByText('Quick')).closest('button') as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/pipelines/quick'));
    expect(await screen.findByRole('heading', { name: 'Quick' })).toBeTruthy();
  });

  it('leads the project tab address of the group to General', async () => {
    show({}, '#settings/project/pipelines');
    await screen.findByTestId('setting-max');
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/general'));
  });

  it('saves an edit of the tags to the shared file', async () => {
    const api = show({}, '#settings/global/pipelines/quick');
    expect(await screen.findByRole('button', { name: 'Remove fast' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Override in the project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove fast' }));
    fireEvent.click(within(screen.getByTestId('pipeline-tags')).getByRole('combobox'));
    fireEvent.change(await screen.findByRole('combobox', { name: /Search in Tags/ }), {
      target: { value: 'slow' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /slow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writePipeline).toHaveBeenCalled());
    expect(api.writePipeline).toHaveBeenCalledWith(
      'quick',
      { name: 'Quick', tags: ['slow'], steps: expect.anything() },
      'g-quick',
      'global',
    );
  });

  it('offers only shared specialists', async () => {
    show({}, '#settings/global/pipelines/quick');
    await screen.findByRole('heading', { name: 'Quick' });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    const triggers = screen.getAllByRole('combobox', { name: /specialist/i });
    fireEvent.keyDown(triggers[triggers.length - 1]!, { key: 'ArrowDown' });
    await screen.findByRole('option', { name: 'coder' });
    expect(screen.queryByRole('option', { name: 'local' })).toBeNull();
  });

  it('asks before leaving a pipeline with unsaved edits', async () => {
    show({}, '#settings/global/pipelines/quick');
    const tags = await screen.findByTestId('pipeline-tags');
    fireEvent.click(within(tags).getByRole('button', { name: 'Remove fast' }));
    fireEvent.click(
      (await (await list()).findByRole('button', { name: /explore/ })) as HTMLElement,
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(window.location.hash).toBe('#settings/global/pipelines/quick');
  });

  it('creates a new pipeline on the shared level and opens it', async () => {
    const api = show();
    fireEvent.click(await screen.findByRole('button', { name: 'New pipeline' }));
    expect(window.location.hash).toBe('#settings/global/pipelines/new');
    fireEvent.change(await screen.findByLabelText('Id'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writePipeline).toHaveBeenCalled());
    expect(vi.mocked(api.writePipeline).mock.calls[0]?.[0]).toBe('fresh');
    expect(vi.mocked(api.writePipeline).mock.calls[0]?.[3]).toBe('global');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/pipelines/fresh'));
  });
});

describe('variants of a shared pipeline', () => {
  it('adds a variant in the settings and writes it to the shared file', async () => {
    const api = show({}, '#settings/global/pipelines/quick');
    await screen.findByRole('heading', { name: 'Quick' });
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'light' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writePipeline).toHaveBeenCalled());
    expect(api.writePipeline).toHaveBeenCalledWith(
      'quick',
      expect.objectContaining({ variants: { light: {} } }),
      'g-quick',
      'global',
    );
  });

  it('loads the models for the variant editor in the settings', async () => {
    const raw = { steps: STEPS, variants: { light: { name: 'Lite' } } };
    const api = show(
      { config: vi.fn(async () => configView({ pipelines: [shared('quick', raw)] })) },
      '#settings/global/pipelines/quick',
    );
    const switcher = await screen.findByRole('radiogroup', { name: 'Pipeline variants' });
    fireEvent.click(within(switcher).getByRole('radio', { name: 'Lite' }));
    const region = within(screen.getByRole('region', { name: 'variant light' }));
    fireEvent.click(await region.findByRole('combobox', { name: 'Model' }));
    expect(await screen.findByRole('option', { name: 'sonnet' })).toBeTruthy();
    expect(api.models).toHaveBeenCalled();
  });

  it('shows the variants of a shared pipeline on the project page without edits', async () => {
    const raw = {
      steps: [...STEPS, { id: 'review', specialist: 'reviewer' }],
      variants: { light: { name: 'Lite', skip: [] } },
    };
    show(
      { config: vi.fn(async () => configView({ pipelines: [shared('quick', raw)] })) },
      '#pipelines/quick',
    );
    const switcher = await screen.findByRole('radiogroup', { name: 'Pipeline variants' });
    fireEvent.click(within(switcher).getByRole('radio', { name: 'Lite' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Add variant' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Delete variant' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const skips = document.querySelectorAll<HTMLButtonElement>('[id*="-skip-"]');
    expect(skips.length).toBe(2);
    for (const skip of skips) expect(skip.disabled).toBe(true);
    const combos = within(screen.getByRole('region', { name: 'variant light' })).getAllByRole(
      'combobox',
    );
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) expect((combo as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('usage of a shared pipeline', () => {
  it('shows the number of projects, their references and the shared level', async () => {
    show({}, '#settings/global/pipelines/quick');
    const block = within(await screen.findByRole('region', { name: 'Used in projects' }));
    expect((await block.findByTestId('usage-count')).textContent).toBe('Projects: 1');
    expect(block.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Shared level: other → split',
      'app: epic → split',
    ]);
    expect(block.getByText('app').getAttribute('title')).toBe('/work/app');
  });

  it('says that the pipeline is not used', async () => {
    show({}, '#settings/global/pipelines/explore');
    const block = within(await screen.findByRole('region', { name: 'Used in projects' }));
    expect(await block.findByText('Not used in any project')).toBeTruthy();
    expect(block.getByTestId('usage-count').textContent).toBe('Projects: 0');
  });

  it('keeps the form when the usage cannot be loaded and blocks delete', async () => {
    show(
      { sharedPipelines: vi.fn(async () => Promise.reject(new Error('daemon is down'))) },
      '#settings/global/pipelines/explore',
    );
    expect(await screen.findByText('Could not load usage: daemon is down')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('disables Delete while the pipeline is used and explains why', async () => {
    show({}, '#settings/global/pipelines/quick');
    const button = await screen.findByRole('button', { name: 'Delete' });
    await screen.findByTestId('usage-count');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('delete-blocked').textContent).toMatch(/while the pipeline is used/);
  });

  it('deletes an unused pipeline after confirmation and goes back to the list', async () => {
    const api = show({}, '#settings/global/pipelines/explore');
    const button = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(api.deletePipeline).toHaveBeenCalledWith('explore', 'g-explore', 'global'),
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/pipelines'));
  });

  it('shows the refusal of the daemon with repositories and rereads the usage', async () => {
    const usage = vi
      .fn()
      .mockResolvedValueOnce({ directory: '/xdg/aip/pipelines', pipelines: [usageOf('explore')] })
      .mockResolvedValue({
        directory: '/xdg/aip/pipelines',
        pipelines: [
          usageOf('explore', {
            projects: [{ repository: '/work/lib', references: [{ pipeline: 'f', split: true }] }],
          }),
        ],
      });
    const api = show(
      {
        sharedPipelines: usage,
        deletePipeline: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [],
          references: [{ pipeline: 'f', split: true, repository: '/work/lib' }],
        })),
      },
      '#settings/global/pipelines/explore',
    );
    const button = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('lib: f → split')).toBeTruthy();
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(api.deletePipeline).toHaveBeenCalledTimes(1);
  });
});
