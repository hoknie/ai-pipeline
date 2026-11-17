// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import * as media from '../src/shared/lib/browser/media.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, repositoryView } from './fixtures.ts';
import {
  accessState,
  editorProvider,
  providersView,
  providerView,
  roleView,
} from './providerFixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Overrides = Parameters<typeof fakeApi>[0];

let counter = 0;
function mount(view: ReturnType<typeof providersView>, overrides: Overrides = {}, section = null) {
  counter += 1;
  const repository = `/repo-${counter}`;
  const api = fakeApi({ providers: vi.fn(async () => view), ...overrides });
  const onSelect = vi.fn();
  render(
    <ProvidersPage
      api={api}
      repository={repository}
      runs={[]}
      selected={null}
      section={section}
      preset={null}
      project={null}
      onSelect={onSelect}
    />,
  );
  return { api, onSelect };
}

describe('the list of providers', () => {
  const unavailable = providerView('zai', {
    name: 'Z.ai',
    status: 'unavailable',
    active: null,
    access: [
      {
        ...accessState({
          runtime: 'claude',
          available: false,
          reasons: ['variable ZAI_KEY is not set'],
        }),
        models: {},
      },
    ],
  });

  it('shows name, slug, level, status with the reason and an empty limit', async () => {
    mount(
      providersView({ providers: [providerView('anthropic', { name: 'Anthropic' }), unavailable] }),
    );
    const list = await screen.findByRole('region', { name: 'Providers' });
    expect(within(list).getByText('Anthropic')).toBeTruthy();
    expect(within(list).getByText('Available')).toBeTruthy();
    expect(within(list).getByText('Unavailable')).toBeTruthy();
    expect(within(list).getByText('variable ZAI_KEY is not set')).toBeTruthy();
    expect(within(list).getAllByText('Shared').length).toBe(2);
    expect(screen.getByTestId('limit-anthropic').textContent).toBe('—');
  });

  it('shows a limit with a countdown while it lasts', async () => {
    const until = Date.now() + 40 * 60_000;
    mount(providersView({ providers: [providerView('zai', { limitUntil: until })] }));
    await screen.findByRole('region', { name: 'Providers' });
    expect(screen.getByTestId('limit-zai').textContent).toMatch(/until .* · \d+ min/);
  });

  it('shows the limit as gone once it has ended', async () => {
    mount(providersView({ providers: [providerView('zai', { limitUntil: Date.now() - 1000 })] }));
    await screen.findByRole('region', { name: 'Providers' });
    expect(screen.getByTestId('limit-zai').textContent).toBe('—');
  });

  it('opens the form of a provider on a click', async () => {
    const { onSelect } = mount(
      providersView({ providers: [providerView('zai', { name: 'Z.ai' })] }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Z\.ai/ }));
    expect(onSelect).toHaveBeenCalledWith('zai', null, null, null);
  });

  it('shows the errors of a configuration that cannot be assembled instead of the list', async () => {
    mount(
      providersView({
        errors: [{ path: 'swarm.providers.zai', message: 'broken file' }] as never,
        providers: [providerView('zai')],
      }),
    );
    expect(await screen.findByText(/broken file/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Providers' })).toBeNull();
  });

  it('dims disabled providers and reads the registry again on focus', async () => {
    const { api } = mount(
      providersView({ providers: [providerView('off', { enabled: false, status: 'disabled' })] }),
    );
    await screen.findByRole('region', { name: 'Providers' });
    expect(screen.getByText('Disabled')).toBeTruthy();
    const before = (api.providers as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.focus(window);
    await waitFor(() =>
      expect((api.providers as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before),
    );
  });
});

describe('the first run', () => {
  it('explains the empty list and offers the presets', async () => {
    const { onSelect } = mount(providersView());
    expect(await screen.findByText('No providers yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Z.ai GLM Coding Plan' }));
    expect(onSelect).toHaveBeenCalledWith('new', null, 'zai');
  });

  it('says there are no roles in the matrix', async () => {
    mount(providersView({ providers: [providerView('zai')] }));
    expect(await screen.findByText(/No roles/)).toBeTruthy();
  });
});

describe('the phone', () => {
  it('draws cards instead of a table below 768 px', async () => {
    vi.spyOn(media, 'useMediaQuery').mockReturnValue(false);
    mount(
      providersView({
        roles: [roleView('code')],
        providers: [providerView('zai', { name: 'Z.ai' })],
      }),
    );
    const list = await screen.findByRole('region', { name: 'Providers' });
    expect(within(list).getByText('Limit:', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the tabs', () => {
  it('has a way to the tab Roles', async () => {
    const { onSelect } = mount(providersView({ providers: [providerView('zai')] }));
    await screen.findByRole('region', { name: 'Providers' });
    fireEvent.click(screen.getByRole('tab', { name: 'Roles' }));
    expect(onSelect).toHaveBeenCalledWith(null, 'roles');
  });
});

describe('the keys of the section', () => {
  const two = () =>
    providersView({
      providers: [
        providerView('zai', { name: 'Z.ai' }),
        providerView('openai', { name: 'OpenAI' }),
      ],
    });

  it('moves the selection with j and k and opens the row with Enter', async () => {
    const { onSelect } = mount(two());
    await screen.findByRole('region', { name: 'Providers' });
    fireEvent.keyDown(window, { key: 'j' });
    const rows = () => screen.getAllByRole('button', { name: /Z\.ai|OpenAI/ });
    expect(rows()[0]?.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'j' });
    expect(rows()[1]?.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'k' });
    expect(rows()[0]?.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('zai', null, null, null);
  });

  it('stays silent while the user types in a field', async () => {
    mount(two());
    await screen.findByRole('region', { name: 'Providers' });
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'j' });
    input.remove();
    expect(
      screen.getAllByRole('button', { name: /Z\.ai|OpenAI/ })[0]?.getAttribute('aria-current'),
    ).toBeNull();
  });
});

describe('the level of a provider', () => {
  it('marks a project provider that overrides a shared one', async () => {
    mount(providersView({ providers: [providerView('zai', { level: 'project' })] }), {
      config: vi.fn(async () =>
        configView({
          providers: [{ ...editorProvider('zai', {}, 'project'), level: 'project_over_global' }],
        }),
      ),
    });
    const list = await screen.findByRole('region', { name: 'Providers' });
    await waitFor(() => expect(within(list).getByText('Project · overrides shared')).toBeTruthy());
  });

  it('marks a plain project provider as a project one', async () => {
    mount(providersView({ providers: [providerView('zai', { level: 'project' })] }));
    const list = await screen.findByRole('region', { name: 'Providers' });
    expect(within(list).getByText('Project')).toBeTruthy();
    expect(within(list).queryByText('Project · overrides shared')).toBeNull();
  });
});

describe('the fallback access', () => {
  it('lists the access that does not work, with its reason in words, in the hint', async () => {
    mount(
      providersView({
        providers: [
          providerView('zai', {
            name: 'Z.ai',
            active: 1,
            access: [
              {
                ...accessState({
                  index: 0,
                  runtime: 'claude',
                  available: false,
                  reasons: ['command claude not found'],
                }),
                models: {},
              },
              { ...accessState({ index: 1, runtime: 'opencode' }), models: {} },
            ],
          }),
        ],
      }),
    );
    const list = await screen.findByRole('region', { name: 'Providers' });
    const access = within(list).getByLabelText('Access that works');
    expect(access.textContent).toBe('opencode');
    expect(access.getAttribute('title')).toContain(
      '1. claude — Unavailable: command claude not found',
    );
    expect(access.getAttribute('title')).toContain('2. opencode — Available');
  });
});

describe('the mode «All projects»', () => {
  const app = repositoryView('/work/app');
  const lib = repositoryView('/work/lib');

  it('shows the shared providers once and each project provider with the mark of its project', async () => {
    const views: Record<string, ReturnType<typeof providersView>> = {
      '/work/app': providersView({
        repository: '/work/app',
        providers: [
          providerView('anthropic', { name: 'Anthropic' }),
          providerView('local', { name: 'Local', level: 'project' }),
        ],
      }),
      '/work/lib': providersView({
        repository: '/work/lib',
        providers: [providerView('anthropic', { name: 'Anthropic' })],
      }),
    };
    const api = fakeApi({ providers: vi.fn(async () => views['/work/app']!) });
    const bind = api.forRepository;
    api.forRepository = (path) => ({
      ...bind(path),
      providers: async () => views[path ?? '']!,
    });
    render(
      <ProvidersPage
        api={api}
        repository="/work/app"
        runs={[]}
        selected={null}
        section={null}
        preset={null}
        project={null}
        projects={{ registry: [app, lib], last: null }}
        onSelect={vi.fn()}
      />,
    );
    const list = await screen.findByRole('region', { name: 'Providers' });
    await waitFor(() => expect(within(list).getAllByText('Anthropic')).toHaveLength(1));
    const local = within(list).getByRole('button', { name: /Local/ });
    expect(within(local).getByText(app.label)).toBeTruthy();
    expect(within(local).getByText('Project')).toBeTruthy();
    expect(screen.getByText(/The shared level is shown/)).toBeTruthy();
  });
});
