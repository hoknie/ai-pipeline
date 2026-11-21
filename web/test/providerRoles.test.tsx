// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import type { EditorSetting } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, repositoryView } from './fixtures.ts';
import { editorProvider, providersView, providerView, roleView } from './providerFixtures.ts';

afterEach(cleanup);

let counter = 0;

function rolesSetting(
  global: Record<string, unknown>,
  project: Record<string, unknown> = {},
): EditorSetting {
  return {
    path: 'roles',
    kind: 'record',
    value: { ...global, ...project },
    file: null,
    globalOnly: false,
    defaultValue: {},
    globalValue: global,
    written: { global, project },
  } as unknown as EditorSetting;
}

/** The levels a call of the fake API wrote to, for every `write*` and `delete*` method. */
function levelsWritten(api: ReturnType<typeof fakeApi>): unknown[] {
  return [
    ...vi.mocked(api.writeSetting).mock.calls.map((call) => call[3]),
    ...vi.mocked(api.writeProvider).mock.calls.map((call) => call[3]),
  ];
}

/** The shared roles think and code, the project ones draft and extra; draft has models. */
function mount(overrides: Parameters<typeof fakeApi>[0] = {}) {
  counter += 1;
  const roles = [
    roleView('think', 'Think'),
    roleView('code', 'Code'),
    roleView('draft', 'Draft', 'project'),
    roleView('extra', 'Extra', 'project'),
  ];
  const providers = [
    providerView('zai', { name: 'Z.ai', models: { draft: { model: 'glm' } } as never }),
    providerView('anthropic', {
      name: 'Anthropic',
      models: { draft: { model: 'sonnet' } } as never,
    }),
  ];
  const api = fakeApi({
    providers: vi.fn(async () => providersView({ roles, providers })),
    config: vi.fn(async () =>
      configView({
        settings: [
          rolesSetting(
            { think: { name: 'Think' }, code: { name: 'Code' } },
            { draft: { name: 'Draft' }, extra: { name: 'Extra' } },
          ),
        ],
        providers: [
          editorProvider('zai', { name: 'Z.ai', models: { draft: 'glm', think: 'x' } }, 'project'),
          editorProvider(
            'anthropic',
            { name: 'Anthropic', models: { draft: 'sonnet' } },
            'project',
          ),
        ],
      }),
    ),
    ...overrides,
  });
  render(
    <ProvidersPage
      api={api}
      repository={`/roles-${counter}`}
      runs={[]}
      selected={null}
      section="roles"
      preset={null}
      project={null}
      onSelect={vi.fn()}
    />,
  );
  return api;
}

/** Opens the details of a role by its line in the list. */
async function pick(line: RegExp) {
  const tab = await screen.findByRole('region', { name: 'Roles' });
  fireEvent.click(within(tab).getByText(line));
}

const enabled = (name: string) =>
  waitFor(() =>
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false),
  );

describe('the tab «Roles»', () => {
  it('shows the models of the open role by provider', async () => {
    mount();
    expect(await screen.findByText('Pick a role in the list.')).toBeTruthy();
    await pick(/draft · Project/);
    const models = await screen.findByRole('region', { name: 'Models of the role' });
    expect(within(models).getByText('Z.ai')).toBeTruthy();
    expect(within(models).getByText('Anthropic')).toBeTruthy();
    expect(within(models).getByText('glm')).toBeTruthy();
  });

  it('lists the roles with their level and the number of providers, with no level to choose', async () => {
    mount();
    const tab = await screen.findByRole('region', { name: 'Roles' });
    expect(within(tab).getByText(/think · Shared · 0 providers/)).toBeTruthy();
    expect(within(tab).getByText(/draft · Project · 2 providers/)).toBeTruthy();
    expect(within(tab).queryByRole('radio')).toBeNull();
  });

  it('adds a role to the project roles only', async () => {
    const api = mount();
    await screen.findByRole('region', { name: 'Roles' });
    await enabled('Add role');
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Review' } });
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('review');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add role' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    const call = vi.mocked(api.writeSetting).mock.calls[0]!;
    expect([call[0], call[1], call[3]]).toEqual([
      'roles',
      { draft: { name: 'Draft' }, extra: { name: 'Extra' }, review: { name: 'Review' } },
      'project',
    ]);
  });

  it('moves a project role down and keeps the others in place', async () => {
    const api = mount();
    await pick(/draft · Project/);
    await enabled('Move Draft down');
    fireEvent.click(screen.getByRole('button', { name: 'Move Draft down' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(Object.keys(vi.mocked(api.writeSetting).mock.calls[0]?.[1] as object)).toEqual([
      'extra',
      'draft',
    ]);
    expect(levelsWritten(api)).toEqual(['project']);
  });

  it('moves the selected role with Alt+↓', async () => {
    const api = mount();
    await pick(/draft · Project/);
    await enabled('Move Draft down');
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(levelsWritten(api)).toEqual(['project']);
  });

  it('keeps a shared role view only: it cannot be moved or removed', async () => {
    const api = mount();
    await pick(/think · Shared/);
    await enabled('Rename Think');
    for (const name of ['Move Think up', 'Move Think down', 'Remove Think']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(api.writeSetting).not.toHaveBeenCalled();
  });

  it('renames a shared role as an override in the project roles', async () => {
    const api = mount();
    await pick(/think · Shared/);
    await enabled('Rename Think');
    fireEvent.click(screen.getByRole('button', { name: 'Rename Think' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Thinker' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    const call = vi.mocked(api.writeSetting).mock.calls[0]!;
    expect([call[0], call[1], call[3]]).toEqual([
      'roles',
      { draft: { name: 'Draft' }, extra: { name: 'Extra' }, think: { name: 'Thinker' } },
      'project',
    ]);
    expect(levelsWritten(api)).toEqual(['project']);
  });

  it('removes a role through clearing its cells, one provider after another', async () => {
    const api = mount();
    await pick(/draft · Project/);
    await enabled('Remove Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Draft' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Z\.ai/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear cells and remove' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(vi.mocked(api.writeProvider).mock.calls.map((call) => call[0])).toEqual([
      'zai',
      'anthropic',
    ]);
    expect(vi.mocked(api.writeProvider).mock.calls[0]?.[1]).toEqual({
      name: 'Z.ai',
      models: { think: 'x' },
    });
    expect(vi.mocked(api.writeSetting).mock.calls[0]?.[1]).toEqual({ extra: { name: 'Extra' } });
    expect(levelsWritten(api).every((level) => level === 'project')).toBe(true);
  });

  it('stops at the first refusal and keeps the role', async () => {
    const api = mount({
      writeProvider: vi.fn(async () => ({
        ok: false as const,
        reason: 'conflict' as const,
        message: 'file changed',
      })),
    });
    await pick(/draft · Project/);
    await enabled('Remove Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Draft' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear cells and remove' }));
    expect(await within(dialog).findByText(/zai: file changed/)).toBeTruthy();
    expect(api.writeProvider).toHaveBeenCalledTimes(1);
    expect(api.writeSetting).not.toHaveBeenCalled();
  });

  it('says so when there are no roles', async () => {
    counter += 1;
    const api = fakeApi({
      providers: vi.fn(async () => providersView({ providers: [providerView('zai')] })),
    });
    render(
      <ProvidersPage
        api={api}
        repository={`/roles-${counter}`}
        runs={[]}
        selected={null}
        section="roles"
        preset={null}
        project={null}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByText('No roles yet. Add the first one.')).toBeTruthy();
  });
});

describe('the roles in the mode «All projects»', () => {
  it('are shown without any way to change them', async () => {
    counter += 1;
    const app = repositoryView('/work/app');
    const lib = repositoryView('/work/lib');
    const view = providersView({
      roles: [roleView('code', 'Code')],
      providers: [
        providerView('zai', { name: 'Z.ai', models: { code: { model: 'glm' } } as never }),
      ],
    });
    const api = fakeApi({ providers: vi.fn(async () => view) });
    const bind = api.forRepository;
    api.forRepository = (path) => ({ ...bind(path), providers: async () => view });
    render(
      <ProvidersPage
        api={api}
        repository="/work/app"
        runs={[]}
        selected={null}
        section="roles"
        preset={null}
        project={null}
        projects={{ registry: [app, lib], last: null }}
        onSelect={vi.fn()}
      />,
    );
    const tab = await screen.findByRole('region', { name: 'Roles' });
    expect(screen.queryByRole('button', { name: /Add role/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(within(tab).getByText(/Code/));
    const models = await screen.findByRole('region', { name: 'Models of the role' });
    expect(within(models).getByText('glm')).toBeTruthy();
    expect(within(models).queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename|Remove|Move/ })).toBeNull();
    expect(screen.getByText('To change, choose a project')).toBeTruthy();
  });
});
