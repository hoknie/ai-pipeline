// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi } from './fixtures.ts';
import { editorProvider, providersView, providerView, roleView } from './providerFixtures.ts';

afterEach(cleanup);

let counter = 0;

type Default = { slug: string; level: 'global' | 'project' } | null;

/** The page with providers `anthropic`, `zai` and `off` (switched off) and a writable default. */
function mount(props: {
  selected?: string | null;
  scope?: 'global';
  initial?: Default;
  writeResult?: { ok: false; reason: 'invalid'; errors: { path: string; message: string }[] };
}) {
  counter += 1;
  const state: { current: Default } = { current: props.initial ?? null };
  const providers = [
    providerView('anthropic', { name: 'Anthropic' }),
    providerView('zai', { name: 'Z.ai' }),
    providerView('off', { name: 'Off', enabled: false, status: 'disabled' }),
  ];
  const api = fakeApi({
    providers: vi.fn(async () =>
      providersView({
        roles: [roleView('think')],
        providers,
        defaultProvider: state.current,
      }),
    ),
    config: vi.fn(async () =>
      configView({
        providers: providers.map((item) =>
          editorProvider(item.slug, {
            name: item.name,
            access: [{ kind: 'cli', runtime: 'claude' }],
          }),
        ),
      }),
    ),
    writeSetting: vi.fn(async (_path: string, value: unknown) => {
      if (props.writeResult) return props.writeResult as never;
      state.current = value === null ? null : { slug: String(value), level: 'global' };
      return { ok: true as const, revision: 'g2', file: '/xdg/aip/settings.yaml' };
    }),
  });
  render(
    <ProvidersPage
      api={api}
      repository={`/default-${counter}`}
      runs={[]}
      selected={props.selected ?? null}
      section={null}
      preset={null}
      project={null}
      {...(props.scope ? { scope: props.scope } : {})}
      onSelect={vi.fn()}
    />,
  );
  return { api, state };
}

const rowOf = async (name: string) => {
  const list = await screen.findByRole('region', { name: 'Providers' });
  return (await within(list).findByText(name)).closest('button')!;
};

describe('the mark of the default provider', () => {
  it('stands in the list at the default provider only', async () => {
    mount({ scope: 'global', initial: { slug: 'anthropic', level: 'global' } });
    expect(within(await rowOf('Anthropic')).getByText('Default')).toBeTruthy();
    expect(within(await rowOf('Z.ai')).queryByText('Default')).toBeNull();
  });

  it('says «shared» in a project for the value of the shared level', async () => {
    mount({ initial: { slug: 'anthropic', level: 'global' } });
    expect(within(await rowOf('Anthropic')).getByText('Default · shared')).toBeTruthy();
  });

  it('has no «shared» for a project value', async () => {
    mount({ initial: { slug: 'zai', level: 'project' } });
    expect(within(await rowOf('Z.ai')).getByText('Default')).toBeTruthy();
  });

  it('explains that a switched-off default provider is not used', async () => {
    mount({ initial: { slug: 'off', level: 'project' } });
    const mark = within(await rowOf('Off')).getByText('Default');
    expect(mark.getAttribute('title')).toContain('switched off');
  });
});

describe('the switch «Default»', () => {
  const toggle = async () =>
    (await screen.findByRole('switch', { name: 'Default' })) as HTMLElement;

  it('assigns at once, without Save and without a dialog when there is no default', async () => {
    const { api } = mount({ selected: 'anthropic', scope: 'global' });
    const sw = await toggle();
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(sw);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith(
        'default_provider',
        'anthropic',
        'g1',
        'global',
      ),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(async () => expect((await toggle()).getAttribute('aria-checked')).toBe('true'));
    expect(api.writeProvider).not.toHaveBeenCalled();
  });

  it('writes the level of the scope: project in a project', async () => {
    const { api } = mount({ selected: 'zai' });
    fireEvent.click(await toggle());
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('default_provider', 'zai', null, 'project'),
    );
  });

  it('removes the key when it is turned off', async () => {
    const { api } = mount({
      selected: 'anthropic',
      scope: 'global',
      initial: { slug: 'anthropic', level: 'global' },
    });
    const sw = await toggle();
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('default_provider', null, 'g1', 'global'),
    );
    await waitFor(async () => expect((await toggle()).getAttribute('aria-checked')).toBe('false'));
  });

  it('is off for a switched-off provider', async () => {
    mount({ selected: 'off', scope: 'global' });
    const sw = (await toggle()) as HTMLButtonElement;
    await waitFor(() => expect(sw.disabled).toBe(true));
  });

  it('is on and unavailable in a project for the shared value', async () => {
    mount({ selected: 'anthropic', initial: { slug: 'anthropic', level: 'global' } });
    const sw = (await toggle()) as HTMLButtonElement;
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(sw.disabled).toBe(true);
    expect(screen.getByText('Set in the shared settings.')).toBeTruthy();
  });

  it('shows the error of the write at the switch and keeps the old state', async () => {
    mount({
      selected: 'anthropic',
      scope: 'global',
      writeResult: {
        ok: false,
        reason: 'invalid',
        errors: [{ path: 'swarm.default_provider', message: 'unknown provider' }],
      },
    });
    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    expect((await screen.findByRole('alert')).textContent).toContain('unknown provider');
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });
});

describe('changing the default provider', () => {
  const toggle = async () =>
    (await screen.findByRole('switch', { name: 'Default' })) as HTMLElement;

  async function askToChange() {
    const mounted = mount({
      selected: 'zai',
      scope: 'global',
      initial: { slug: 'anthropic', level: 'global' },
    });
    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    const dialog = await screen.findByRole('alertdialog');
    return { ...mounted, dialog };
  }

  it('asks first, writes nothing before «Assign», and then writes once', async () => {
    const { api, dialog } = await askToChange();
    expect(within(dialog).getByText(/Default provider — «Anthropic»/)).toBeTruthy();
    expect(within(dialog).getByText(/assign «Z\.ai»\?/)).toBeTruthy();
    expect(api.writeSetting).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalledTimes(1));
    expect(api.writeSetting).toHaveBeenCalledWith('default_provider', 'zai', 'g1', 'global');
    await waitFor(async () => expect((await toggle()).getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('writes nothing on Cancel and keeps the switch off', async () => {
    const { api, dialog } = await askToChange();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.writeSetting).not.toHaveBeenCalled();
    expect((await toggle()).getAttribute('aria-checked')).toBe('false');
  });

  it('writes nothing on Esc', async () => {
    const { api, dialog } = await askToChange();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.writeSetting).not.toHaveBeenCalled();
  });

  it('writes the project file over the shared value and says the shared one stays', async () => {
    const { api } = mount({ selected: 'zai', initial: { slug: 'anthropic', level: 'global' } });
    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/stays the default of the other projects/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('default_provider', 'zai', null, 'project'),
    );
  });
});

describe('a new provider as the default one', () => {
  const nameField = () => screen.findByLabelText('Name');
  const save = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  };

  it('is off at the start and written to settings after the file is saved', async () => {
    const { api } = mount({ selected: 'new', scope: 'global' });
    fireEvent.change(await nameField(), { target: { value: 'Fresh' } });
    const sw = screen.getByRole('switch', { name: 'Default' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await save();
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.writeSetting).toHaveBeenCalledWith('default_provider', 'fresh', 'g1', 'global'),
    );
  });

  it('asks first when another provider is the default', async () => {
    const { api } = mount({
      selected: 'new',
      scope: 'global',
      initial: { slug: 'anthropic', level: 'global' },
    });
    fireEvent.change(await nameField(), { target: { value: 'Fresh' } });
    const sw = screen.getByRole('switch', { name: 'Default' });
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(sw);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Assign' }),
    );
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(api.writeSetting).not.toHaveBeenCalled();
  });

  it('keeps the provider and shows the error of the second write in the form', async () => {
    const { api } = mount({
      selected: 'new',
      scope: 'global',
      writeResult: {
        ok: false,
        reason: 'invalid',
        errors: [{ path: 'swarm.default_provider', message: 'refused' }],
      },
    });
    fireEvent.change(await nameField(), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Default' }));
    await save();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'saved, but not made the default',
    );
    expect(api.writeProvider).toHaveBeenCalledTimes(1);
  });
});
