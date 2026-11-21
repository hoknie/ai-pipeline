// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';

import { fakeApi, groupRow, runView } from './fixtures.ts';

afterEach(() => {
  cleanup();
  toast.dismiss();
});

const cancelled = (extra = {}) =>
  runView({
    finished: true,
    state: 'cancelled',
    cleanable: true,
    groups: [groupRow({ status: 'cancelled' })],
    ...extra,
  });

function openMore() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
}

const item = () => screen.getByRole('menuitem', { name: 'Clean up…' });

describe('cleaning a run up from the header', () => {
  it('is available for a finished run and sends nothing when the dialog is dismissed', async () => {
    const api = fakeApi();
    render(<RunHeader run={cancelled()} api={api} now={0} onError={vi.fn()} />);
    openMore();
    expect(item().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(item());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('worktrees and service refs');
    expect(dialog.textContent).not.toContain('not delivered');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.cleanRun).not.toHaveBeenCalled();
  });

  it('cleans after the confirmation', async () => {
    const api = fakeApi();
    render(<RunHeader run={cancelled()} api={api} now={0} onError={vi.fn()} />);
    openMore();
    fireEvent.click(item());
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clean up' }));
    await waitFor(() => expect(api.cleanRun).toHaveBeenCalledWith('run1'));
    expect(await screen.findByText('Run cleaned up')).toBeTruthy();
  });

  it('warns about merged groups that are not delivered', async () => {
    const run = cancelled({ delivery: { ...runView().delivery, merged: 2, applied: 1 } });
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={vi.fn()} />);
    openMore();
    fireEvent.click(item());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('not delivered');
  });

  it('is off for an active run', () => {
    render(
      <RunHeader run={runView({ cleanable: false })} api={fakeApi()} now={0} onError={vi.fn()} />,
    );
    openMore();
    expect(item().getAttribute('aria-disabled')).toBe('true');
  });

  it('explains why it is off for a run whose task stands in the queue', () => {
    render(
      <RunHeader
        run={cancelled({ cleanable: false, queueItem: 'q-1' })}
        api={fakeApi()}
        now={0}
        onError={vi.fn()}
      />,
    );
    openMore();
    expect(item().getAttribute('aria-disabled')).toBe('true');
    expect(item().getAttribute('title')).toBe(
      'The run is in the queue: remove its task to clean it up',
    );
  });

  it('offers no retries and no delivery for a cleaned-up run', () => {
    const run = cancelled({
      cleanable: false,
      cleanedAt: 5,
      delivery: { ...runView().delivery, merged: 1, applied: 0 },
    });
    render(<RunHeader run={run} api={fakeApi()} now={0} onError={vi.fn()} />);
    openMore();
    expect(screen.queryByText(/Retry failed/)).toBeNull();
    expect(item().getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByRole('menuitem', { name: 'Deliver with --force…' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });
});
