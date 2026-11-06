// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import type { Api } from '../src/api.ts';
import type { SharedSpecialistView } from '../src/types.ts';

import { configView, fakeApi, openFake, queueOf, settingsOf, specialistEntry } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const shared = (slug: string, raw: Record<string, unknown> = { name: slug.toUpperCase() }) =>
  specialistEntry(slug, {
    level: 'global',
    file: `/xdg/aip/specialists/${slug}.yaml`,
    revision: `g-${slug}`,
    raw,
  });

const usageOf = (
  slug: string,
  overrides: Partial<SharedSpecialistView> = {},
): SharedSpecialistView => ({
  slug,
  name: slug.toUpperCase(),
  file: `/xdg/aip/specialists/${slug}.yaml`,
  revision: `g-${slug}`,
  global: [],
  projects: [],
  ...overrides,
});

const view = () =>
  configView({
    specialists: [
      specialistEntry('coder'),
      shared('qa', { name: 'Tester', model: 'haiku' }),
      shared('writer'),
      // a project file over a shared one: the group shows the shared values
      specialistEntry(
        'plan',
        {
          level: 'project_over_global',
          raw: { name: 'Project plan' },
          sources: {
            project: {
              file: '/repo/aip/specialists/plan.yaml',
              revision: 'p-plan',
              raw: { name: 'Project plan' },
            },
            global: {
              file: '/xdg/aip/specialists/plan.yaml',
              revision: 'g-plan',
              raw: { name: 'Shared plan' },
            },
          },
        },
        { name: 'Project plan' },
      ),
    ],
    pipelines: [],
  });

function show(overrides: Partial<Api> = {}, hash = '#settings/global/specialists') {
  window.location.hash = hash;
  const api = fakeApi({
    queue: vi.fn(async () => queueOf()),
    config: vi.fn(async () => view()),
    sharedSpecialists: vi.fn(async () => ({
      directory: '/xdg/aip/specialists',
      specialists: [
        usageOf('qa', {
          projects: [
            {
              repository: '/work/app',
              references: [{ pipeline: 'feature', step: 'test' }, { field: 'delivery.resolver' }],
            },
            { repository: '/work/lib', references: [{ pipeline: 'feature', split: true }] },
          ],
          global: [{ pipeline: 'quick', step: 'check' }],
        }),
        usageOf('writer'),
        usageOf('plan'),
      ],
    })),
    ...overrides,
  });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const list = async () => within(await screen.findByRole('list', { name: 'Shared specialists' }));

describe('shared specialists group', () => {
  it('lists only specialists with a shared file, with their shared values', async () => {
    show();
    const entries = await list();
    expect(entries.getAllByRole('button').length).toBe(3);
    expect(entries.queryByText('coder')).toBeNull();
    expect(entries.getByText('Tester')).toBeTruthy();
    // the overridden one shows the shared name, not the project one
    expect(entries.getByText('Shared plan')).toBeTruthy();
    expect(entries.queryByText('Project plan')).toBeNull();
    const region = screen.getByRole('region', { name: 'Where the settings are saved' });
    expect(within(region).getByText('/xdg/aip/specialists')).toBeTruthy();
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('searches by slug and name and shows the empty states', async () => {
    show();
    const entries = await list();
    const search = screen.getByRole('searchbox', { name: 'Search by slug or name' });
    fireEvent.change(search, { target: { value: 'tester' } });
    expect(entries.getAllByRole('button').length).toBe(1);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('shows the empty state without shared specialists', async () => {
    show({ config: vi.fn(async () => configView({ specialists: [specialistEntry('coder')] })) });
    expect(await screen.findByText('No shared specialists yet')).toBeTruthy();
  });

  it('changes the address when a specialist is chosen and opens it from the address', async () => {
    show();
    fireEvent.click((await (await list()).findByText('Tester')).closest('button') as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/specialists/qa'));
    expect(await screen.findByRole('heading', { name: 'qa' })).toBeTruthy();
  });

  it('opens the specialist of the address and nothing for an unknown slug', async () => {
    show({}, '#settings/global/specialists/writer');
    expect(await screen.findByRole('heading', { name: 'writer' })).toBeTruthy();
    cleanup();
    show({}, '#settings/global/specialists/nobody');
    await list();
    expect(screen.queryByRole('heading', { name: 'nobody' })).toBeNull();
    expect(screen.getByText('Choose a specialist on the left')).toBeTruthy();
  });

  it('saves an edit to the shared level and keeps the tags', async () => {
    const api = show(
      {
        config: vi.fn(async () =>
          configView({
            specialists: [shared('qa', { name: 'Tester', tags: ['qa-tag'] })],
          }),
        ),
      },
      '#settings/global/specialists/qa',
    );
    const model = await screen.findByLabelText('Model');
    expect((model as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(model, { target: { value: 'opus' } });
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Override in the project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make shared' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeSpecialist).toHaveBeenCalled());
    expect(api.writeSpecialist).toHaveBeenCalledWith(
      'qa',
      { name: 'Tester', model: 'opus', tags: ['qa-tag'] },
      'g-qa',
      'global',
    );
  });

  it('asks before leaving a specialist with unsaved edits', async () => {
    show({}, '#settings/global/specialists/qa');
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click((await (await list()).findByText('WRITER')).closest('button') as HTMLElement);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(window.location.hash).toBe('#settings/global/specialists/qa');
  });

  it('creates a new specialist on the shared level and opens it', async () => {
    const api = show();
    fireEvent.click(await screen.findByRole('button', { name: 'New specialist' }));
    expect(window.location.hash).toBe('#settings/global/specialists/new');
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'helper' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Helper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeSpecialist).toHaveBeenCalled());
    expect(api.writeSpecialist).toHaveBeenCalledWith('helper', { name: 'Helper' }, null, 'global');
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/specialists/helper'));
  });

  it('hints the shared defaults, not the project ones', async () => {
    show(
      {
        config: vi.fn(async () =>
          configView({
            specialists: [shared('qa')],
            settings: settingsOf({
              'defaults.permissions': {
                path: 'defaults.permissions',
                value: 'edit',
                globalValue: 'read',
              },
            }),
          }),
        ),
      },
      '#settings/global/specialists/qa',
    );
    await screen.findByLabelText('Model');
    expect(screen.getAllByText(/read \(from defaults\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/edit \(from defaults\)/)).toBeNull();
  });
});

describe('usage of a shared specialist', () => {
  it('shows the number of projects, their references and the shared level', async () => {
    show({}, '#settings/global/specialists/qa');
    const block = within(await screen.findByRole('region', { name: 'Used in projects' }));
    expect((await block.findByTestId('usage-count')).textContent).toBe('Projects: 2');
    const items = block.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Shared level: quick → check',
      'app: feature → test, delivery.resolver',
      'lib: feature → split',
    ]);
    expect(block.getByText('app').getAttribute('title')).toBe('/work/app');
  });

  it('says that the specialist is not used', async () => {
    show({}, '#settings/global/specialists/writer');
    const block = within(await screen.findByRole('region', { name: 'Used in projects' }));
    expect(await block.findByText('Not used in any project')).toBeTruthy();
    expect(block.getByTestId('usage-count').textContent).toBe('Projects: 0');
  });

  it('keeps the form when the usage cannot be loaded and blocks delete', async () => {
    show(
      { sharedSpecialists: vi.fn(async () => Promise.reject(new Error('daemon is down'))) },
      '#settings/global/specialists/writer',
    );
    expect(await screen.findByText('Could not load usage: daemon is down')).toBeTruthy();
    expect(screen.getByLabelText('Model')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('disables Delete while the specialist is used and explains why', async () => {
    show({}, '#settings/global/specialists/qa');
    const button = await screen.findByRole('button', { name: 'Delete' });
    await screen.findByTestId('usage-count');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('delete-blocked').textContent).toMatch(
      /while the specialist is used/,
    );
  });

  it('keeps Delete disabled until the usage is loaded', async () => {
    let release: (value: unknown) => void = () => undefined;
    show(
      {
        sharedSpecialists: vi.fn(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }) as never,
        ),
      },
      '#settings/global/specialists/writer',
    );
    const button = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    release({ directory: '/xdg/aip/specialists', specialists: [usageOf('writer')] });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('deletes an unused specialist after confirmation and goes back to the list', async () => {
    const api = show({}, '#settings/global/specialists/writer');
    const button = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/\/xdg\/aip\/specialists\/writer\.yaml/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(api.deleteSpecialist).toHaveBeenCalledWith('writer', 'g-writer', 'global'),
    );
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/specialists'));
  });

  it('shows the refusal of the daemon with repositories and rereads the usage', async () => {
    const usage = vi
      .fn()
      .mockResolvedValueOnce({
        directory: '/xdg/aip/specialists',
        specialists: [usageOf('writer')],
      })
      .mockResolvedValue({
        directory: '/xdg/aip/specialists',
        specialists: [
          usageOf('writer', {
            projects: [{ repository: '/work/lib', references: [{ pipeline: 'f', step: 's' }] }],
          }),
        ],
      });
    const api = show(
      {
        sharedSpecialists: usage,
        deleteSpecialist: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [],
          references: [{ pipeline: 'f', step: 's', repository: '/work/lib' }],
        })),
      },
      '#settings/global/specialists/writer',
    );
    const button = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('lib: f → s')).toBeTruthy();
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(api.deleteSpecialist).toHaveBeenCalledTimes(1);
  });
});
