// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import type { EditorSetting } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi } from './fixtures.ts';
import { editorProvider, providersView, providerView, roleView } from './providerFixtures.ts';

afterEach(cleanup);

let counter = 0;

function rolesSetting(global: Record<string, unknown>): EditorSetting {
  return {
    path: 'roles',
    kind: 'record',
    value: global,
    file: null,
    globalOnly: false,
    defaultValue: {},
    globalValue: global,
    written: { global },
  } as unknown as EditorSetting;
}

function mount(overrides: Parameters<typeof fakeApi>[0] = {}) {
  counter += 1;
  const roles = [roleView('think', 'Think'), roleView('code', 'Code')];
  const providers = [
    providerView('zai', { name: 'Z.ai', models: { code: { model: 'glm' } } as never }),
    providerView('anthropic', {
      name: 'Anthropic',
      models: { code: { model: 'sonnet' } } as never,
    }),
  ];
  const api = fakeApi({
    providers: vi.fn(async () => providersView({ roles, providers })),
    config: vi.fn(async () =>
      configView({
        settings: [rolesSetting({ think: { name: 'Think' }, code: { name: 'Code' } })],
        providers: [
          editorProvider('zai', { name: 'Z.ai', models: { code: 'glm', think: 'x' } }, 'project'),
          editorProvider('anthropic', { name: 'Anthropic', models: { code: 'sonnet' } }, 'project'),
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

describe('the tab «Roles»', () => {
  it('shows the models of the open role by provider', async () => {
    mount();
    expect(await screen.findByText('Pick a role in the list.')).toBeTruthy();
    await pick(/code · Shared/);
    const models = await screen.findByRole('region', { name: 'Models of the role' });
    expect(within(models).getByText('Z.ai')).toBeTruthy();
    expect(within(models).getByText('Anthropic')).toBeTruthy();
    expect(within(models).getByText('glm')).toBeTruthy();
  });

  it('lists the roles with the number of providers and shared level by default', async () => {
    mount();
    const tab = await screen.findByRole('region', { name: 'Roles' });
    expect(within(tab).getByText(/code · Shared · 2 providers/)).toBeTruthy();
    expect(within(tab).getByRole('radio', { name: 'Shared' }).getAttribute('data-state')).toBe(
      'on',
    );
  });

  it('adds a role with a slug made of the name', async () => {
    const api = mount();
    await screen.findByRole('region', { name: 'Roles' });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Add role' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Review' } });
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('review');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add role' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(vi.mocked(api.writeSetting).mock.calls[0]?.slice(0, 2)).toEqual([
      'roles',
      { think: { name: 'Think' }, code: { name: 'Code' }, review: { name: 'Review' } },
    ]);
  });

  it('moves a role down and keeps the others in place', async () => {
    const api = mount();
    await pick(/think · Shared/);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Move Think down' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move Think down' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(Object.keys(vi.mocked(api.writeSetting).mock.calls[0]?.[1] as object)).toEqual([
      'code',
      'think',
    ]);
  });

  it('moves the selected role with Alt+↓', async () => {
    const api = mount();
    await pick(/think · Shared/);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Move Think down' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(Object.keys(vi.mocked(api.writeSetting).mock.calls[0]?.[1] as object)).toEqual([
      'code',
      'think',
    ]);
  });

  it('removes a role through clearing its cells, one provider after another', async () => {
    const api = mount();
    await pick(/code · Shared/);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Remove Code' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Code' }));
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
    expect(vi.mocked(api.writeSetting).mock.calls[0]?.[1]).toEqual({ think: { name: 'Think' } });
  });

  it('stops at the first refusal and keeps the role', async () => {
    const api = mount({
      writeProvider: vi.fn(async () => ({
        ok: false as const,
        reason: 'conflict' as const,
        message: 'file changed',
      })),
    });
    await pick(/code · Shared/);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Remove Code' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Code' }));
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
