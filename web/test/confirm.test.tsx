// @vitest-environment jsdom
import { render as plainRender } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConfirm } from '../src/shared/ui/overlays/confirm.tsx';
import { notifyError, notifySuccess } from '../src/shared/lib/browser/notify.ts';

import { act, cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Ask({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() =>
        void confirm({
          title: 'Delete?',
          description: 'The file will be deleted.',
          destructive: true,
        }).then(onAnswer)
      }
    >
      Ask
    </button>
  );
}

describe('confirm', () => {
  it('answers true on the confirmation and false on the refusal', async () => {
    const answers: boolean[] = [];
    render(<Ask onAnswer={(answer) => answers.push(answer)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      'The file will be deleted.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(answers).toEqual([true]));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(answers).toEqual([true, false]));
  });

  it('answers false on Esc and returns the focus to the button that asked', async () => {
    const answers: boolean[] = [];
    render(<Ask onAnswer={(answer) => answers.push(answer)} />);
    const opener = screen.getByRole('button', { name: 'Ask' });
    opener.focus();
    fireEvent.click(opener);
    const refuse = await screen.findByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(refuse);
    fireEvent.keyDown(refuse, { key: 'Escape' });
    await waitFor(() => expect(answers).toEqual([false]));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('needs the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => plainRender(<Ask onAnswer={vi.fn()} />)).toThrow(/ConfirmProvider/);
  });
});

describe('notifications', () => {
  it('keeps two errors on the screen together', async () => {
    render(<div />);
    act(() => {
      notifyError(new Error('first error'));
      notifyError('second error');
    });
    expect(await screen.findByText('first error')).toBeTruthy();
    expect(await screen.findByText('second error')).toBeTruthy();
  });

  it('removes a success by the timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<div />);
    act(() => notifySuccess('Saved'));
    expect(await screen.findByText('Saved')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });
});
