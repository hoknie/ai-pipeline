// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import type { RunView } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fakeApi, pipelineOf, pipelinesView, runView, topologyOf, variantOf } from './fixtures.ts';

afterEach(cleanup);

const steps = pipelineOf().steps;

function apiWith(variantIds: string[], overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    pipelines: vi.fn(async () =>
      pipelinesView({
        pipelines: [
          pipelineOf({
            variants: variantIds.map((id) => variantOf(steps, id, id === 'strong' ? 'Strong' : id)),
          }),
        ],
      }),
    ),
    ...overrides,
  });
}

async function openMenu(run: RunView, api: ReturnType<typeof fakeApi>) {
  render(<RunHeader run={run} api={api} now={0} onError={() => undefined} />);
  await waitFor(() => expect(api.calls.some(([name]) => name === 'pipelines')).toBe(true));
  // the variants arrive after the first render of the header
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
}

describe('switching the variant from the menu «More»', () => {
  it('offers the item when the pipeline has more than default', async () => {
    await openMenu(runView(), apiWith(['default', 'light', 'strong']));
    expect(await screen.findByRole('menuitem', { name: 'Change variant…' })).toBeTruthy();
  });

  it('has no item when default is the only variant', async () => {
    await openMenu(runView(), apiWith(['default']));
    await screen.findByRole('menuitem', { name: 'Copy run id' });
    expect(screen.queryByRole('menuitem', { name: 'Change variant…' })).toBeNull();
  });

  it('has no item for a finished run', async () => {
    await openMenu(
      runView({ finished: true, state: 'finished', topology: topologyOf() }),
      apiWith(['default', 'strong']),
    );
    await screen.findByRole('menuitem', { name: 'Copy run id' });
    expect(screen.queryByRole('menuitem', { name: 'Change variant…' })).toBeNull();
  });

  it('switches to the chosen variant', async () => {
    const api = apiWith(['default', 'light', 'strong']);
    await openMenu(runView(), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change variant…' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Change variant' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText(/Strong/));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.setRunVariant).toHaveBeenCalledWith('run1', 'strong'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog and shows the refusal of the daemon', async () => {
    const api = apiWith(['default', 'strong'], {
      setRunVariant: vi.fn(async () => {
        throw new Error('pipeline `feature` changed since the run started: step `code` is gone');
      }),
    });
    await openMenu(runView(), api);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change variant…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/Strong/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change variant' }));
    expect(await within(dialog).findByText(/step `code` is gone/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
