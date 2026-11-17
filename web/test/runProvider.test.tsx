// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import type { RunView } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fakeApi, runView, topologyOf } from './fixtures.ts';
import { providersView, providerView } from './providerFixtures.ts';

afterEach(cleanup);

const NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', zai: 'Z.ai' };

function apiWith(providers: string[], overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    providers: vi.fn(async () =>
      providersView({
        providers: providers.map((slug) => providerView(slug, { name: NAMES[slug] ?? slug })),
      }),
    ),
    ...overrides,
  });
}

async function openMenu(run: RunView, api: ReturnType<typeof fakeApi>) {
  render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
  await waitFor(() => expect(api.calls.some(([name]) => name === 'providers')).toBe(true));
  // the providers arrive after the first render of the header
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
}

async function chooseProvider(dialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(dialog).getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('switching the provider from the menu «More»', () => {
  it('switches to the chosen provider and marks the current one', async () => {
    const api = apiWith(['anthropic', 'openai', 'zai']);
    await openMenu(runView({ provider: 'zai' }), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/without a commit/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Change provider' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('combobox'));
    expect(
      within(await screen.findByRole('option', { name: /Z\.ai/ })).getByText('(current)'),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole('option', { name: /OpenAI/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.setRunProvider).toHaveBeenCalledWith('run1', 'openai'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resets the provider with «Not selected»', async () => {
    const api = apiWith(['anthropic', 'zai']);
    await openMenu(runView({ provider: 'zai' }), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Not selected/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change provider' }));
    await waitFor(() => expect(api.setRunProvider).toHaveBeenCalledWith('run1', null));
  });

  it('has no item when the project has no provider', async () => {
    await openMenu(runView(), apiWith([]));
    await screen.findByRole('menuitem', { name: 'Copy run id' });
    expect(screen.queryByRole('menuitem', { name: 'Change provider…' })).toBeNull();
  });

  it('has no item for a finished run', async () => {
    await openMenu(
      runView({ finished: true, state: 'finished', topology: topologyOf() }),
      apiWith(['anthropic', 'zai']),
    );
    await screen.findByRole('menuitem', { name: 'Copy run id' });
    expect(screen.queryByRole('menuitem', { name: 'Change provider…' })).toBeNull();
  });

  it('keeps the dialog and shows the refusal of the daemon', async () => {
    const api = apiWith(['anthropic', 'zai'], {
      setRunProvider: vi.fn(async () => {
        throw new Error('unknown provider `zai`; known: anthropic');
      }),
    });
    await openMenu(runView(), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    await chooseProvider(dialog, /Z\.ai/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change provider' }));
    expect(await within(dialog).findByText(/unknown provider/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the previous choice when the creation of a provider is closed', async () => {
    const api = apiWith(['anthropic', 'zai']);
    await openMenu(runView({ provider: 'zai' }), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Create provider/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(within(screen.getByRole('dialog')).getByRole('combobox').textContent).toContain('Z.ai');
  });
});
