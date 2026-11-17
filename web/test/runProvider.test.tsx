// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import type { RunView } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fakeApi, pipelinesView, runView, topologyOf } from './fixtures.ts';

afterEach(cleanup);

function apiWith(providers: string[], overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    pipelines: vi.fn(async () => pipelinesView({ providers })),
    ...overrides,
  });
}

async function openMenu(run: RunView, api: ReturnType<typeof fakeApi>) {
  render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
  await waitFor(() => expect(api.calls.some(([name]) => name === 'pipelines')).toBe(true));
  // the providers arrive after the first render of the header
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
}

describe('switching the provider from the menu «More»', () => {
  it('switches to the chosen provider', async () => {
    const api = apiWith(['anthropic', 'openai', 'zai']);
    await openMenu(runView({ provider: 'zai' }), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/without a commit/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Change provider' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText('openai'));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.setRunProvider).toHaveBeenCalledWith('run1', 'openai'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resets the provider with «Not selected»', async () => {
    const api = apiWith(['anthropic', 'zai']);
    await openMenu(runView({ provider: 'zai' }), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change provider…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Not selected'));
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
    fireEvent.click(within(dialog).getByLabelText('zai'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change provider' }));
    expect(await within(dialog).findByText(/unknown provider/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
