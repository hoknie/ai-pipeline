// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import type { EditorWorkflow, SharedWorkflowView } from '../src/types.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, openFake, queueOf, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('../src/components/WorkflowGraph.tsx', () => ({
  WorkflowGraph: () => <div data-testid="graph" />,
}));

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STEPS = [{ id: 'code', specialist: 'coder' }];

const shared = (id: string, raw: Record<string, unknown> = { steps: STEPS }): EditorWorkflow => {
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : [];
  const base = {
    id,
    level: 'global' as const,
    file: `/xdg/aip/workflows/${id}.yaml`,
    revision: `g-${id}`,
    raw,
    shared_tags: tags,
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('workflows', base) };
};

const project = (id: string): EditorWorkflow => {
  const base = {
    id,
    level: 'project' as const,
    file: `/repo/aip/workflows/${id}.yaml`,
    revision: `p-${id}`,
    raw: { steps: STEPS },
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('workflows', base) };
};

const usageOf = (id: string, overrides: Partial<SharedWorkflowView> = {}): SharedWorkflowView => ({
  id,
  name: null,
  tags: [],
  file: `/xdg/aip/workflows/${id}.yaml`,
  revision: `g-${id}`,
  global: [],
  projects: [],
  ...overrides,
});

const view = () =>
  configView({
    specialists: [specialistEntry('coder', { level: 'global' }), specialistEntry('local')],
    workflows: [
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
    sharedWorkflows: vi.fn(async () => ({
      directory: '/xdg/aip/workflows',
      workflows: [
        usageOf('quick', {
          projects: [{ repository: '/work/app', references: [{ workflow: 'epic', split: true }] }],
          global: [{ workflow: 'other', split: true }],
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
    expect(within(region).getByText('/xdg/aip/workflows')).toBeTruthy();
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
    show({ config: vi.fn(async () => configView({ workflows: [project('feature')] })) });
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
    fireEvent.click(within(screen.getByTestId('workflow-tags')).getByRole('combobox'));
    fireEvent.change(await screen.findByRole('combobox', { name: /Search in Tags/ }), {
      target: { value: 'slow' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /slow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeWorkflow).toHaveBeenCalled());
    expect(api.writeWorkflow).toHaveBeenCalledWith(
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
    const tags = await screen.findByTestId('workflow-tags');
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
    await waitFor(() => expect(api.writeWorkflow).toHaveBeenCalled());
    expect(vi.mocked(api.writeWorkflow).mock.calls[0]?.[0]).toBe('fresh');
    expect(vi.mocked(api.writeWorkflow).mock.calls[0]?.[3]).toBe('global');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/pipelines/fresh'));
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
      { sharedWorkflows: vi.fn(async () => Promise.reject(new Error('daemon is down'))) },
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
      expect(api.deleteWorkflow).toHaveBeenCalledWith('explore', 'g-explore', 'global'),
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/pipelines'));
  });

  it('shows the refusal of the daemon with repositories and rereads the usage', async () => {
    const usage = vi
      .fn()
      .mockResolvedValueOnce({ directory: '/xdg/aip/workflows', workflows: [usageOf('explore')] })
      .mockResolvedValue({
        directory: '/xdg/aip/workflows',
        workflows: [
          usageOf('explore', {
            projects: [{ repository: '/work/lib', references: [{ workflow: 'f', split: true }] }],
          }),
        ],
      });
    const api = show(
      {
        sharedWorkflows: usage,
        deleteWorkflow: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [],
          references: [{ workflow: 'f', split: true, repository: '/work/lib' }],
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
    expect(api.deleteWorkflow).toHaveBeenCalledTimes(1);
  });
});
