// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestFocus, takeFocusRequest, useHotkey } from '../src/hotkeys.ts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../src/ui/dialog.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => cleanup());

function Keys({ onJ, onMod }: { onJ: () => void; onMod: () => void }) {
  useHotkey('j', onJ);
  useHotkey('mod+k', onMod);
  return (
    <>
      <input aria-label="field" />
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog</DialogTitle>
          <DialogDescription>description</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Plain({ onJ }: { onJ: () => void }) {
  useHotkey('j', onJ);
  return <input aria-label="field" />;
}

describe('hotkeys', () => {
  it('does not fire a plain key inside an input, and fires it elsewhere', () => {
    const onJ = vi.fn();
    render(<Plain onJ={onJ} />);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'j' });
    expect(onJ).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(onJ).toHaveBeenCalledTimes(1);
  });

  it('does not fire a plain key while a dialog is open, but mod+k works in inputs and dialogs', async () => {
    const onJ = vi.fn();
    const onMod = vi.fn();
    render(<Keys onJ={onJ} onMod={onMod} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(onJ).not.toHaveBeenCalled();
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    fireEvent.keyDown(document.querySelector('input')!, {
      key: 'k',
      metaKey: isMac,
      ctrlKey: !isMac,
    });
    expect(onMod).toHaveBeenCalledTimes(1);
  });

  it('hands a focus request to a field mounted before or after the request', () => {
    const early = vi.fn();
    const stop = takeFocusRequest('queue-task', early);
    requestFocus('queue-task');
    expect(early).toHaveBeenCalledTimes(1);
    stop();
    requestFocus('queue-task');
    const late = vi.fn();
    const stopLate = takeFocusRequest('queue-task', late);
    expect(late).toHaveBeenCalledTimes(1);
    stopLate();
  });
});
