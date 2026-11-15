// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  comboKeys,
  requestFocus,
  takeFocusRequest,
  useHotkey,
} from '../src/shared/lib/browser/hotkeys.ts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../src/shared/ui/overlays/dialog.tsx';

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

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function Layout({ onJ, onMod }: { onJ: () => void; onMod: () => void }) {
  useHotkey('j', onJ);
  useHotkey('mod+k', onMod);
  return null;
}

describe('hotkeys by physical key', () => {
  it('fires j and mod+k in the Russian layout, not with Shift or Alt', () => {
    const onJ = vi.fn();
    const onMod = vi.fn();
    render(<Layout onJ={onJ} onMod={onMod} />);
    fireEvent.keyDown(document.body, { key: 'о', code: 'KeyJ' });
    expect(onJ).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'J', code: 'KeyJ', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ', altKey: true });
    fireEvent.keyDown(document.body, { key: 'о', code: 'KeyK' });
    expect(onJ).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, {
      key: 'л',
      code: 'KeyK',
      metaKey: isMac,
      ctrlKey: !isMac,
    });
    expect(onMod).toHaveBeenCalledTimes(1);
  });
});

function Sequence({ onSeq, onP }: { onSeq: () => void; onP?: () => void }) {
  useHotkey('g q', onSeq);
  useHotkey('g p', onSeq);
  useHotkey('p', onP ?? (() => undefined));
  return <input aria-label="field" />;
}

describe('hotkey sequences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const press = (key: string, target: Element = document.body) =>
    fireEvent.keyDown(target, { key, code: `Key${key.toUpperCase()}` });
  const settle = () => {
    // a separate key press clears a pending sequence of an earlier test
    press('z');
  };

  it('fires on the second key and ignores an unrelated key between', () => {
    const onSeq = vi.fn();
    render(<Sequence onSeq={onSeq} />);
    settle();
    press('g');
    press('q');
    expect(onSeq).toHaveBeenCalledTimes(1);
    press('g');
    press('x');
    press('q');
    expect(onSeq).toHaveBeenCalledTimes(1);
  });

  it('forgets the first key after the timeout', () => {
    const onSeq = vi.fn();
    render(<Sequence onSeq={onSeq} />);
    press('g');
    vi.setSystemTime(Date.now() + 2000);
    press('q');
    expect(onSeq).not.toHaveBeenCalled();
  });

  it('does not start in an input field', () => {
    const onSeq = vi.fn();
    render(<Sequence onSeq={onSeq} />);
    press('g', screen.getByLabelText('field'));
    press('q');
    expect(onSeq).not.toHaveBeenCalled();
  });

  it('g p does not trigger the single key p', () => {
    const onSeq = vi.fn();
    const onP = vi.fn();
    render(<Sequence onSeq={onSeq} onP={onP} />);
    press('g');
    press('p');
    expect(onSeq).toHaveBeenCalledTimes(1);
    expect(onP).not.toHaveBeenCalled();
    press('p');
    expect(onP).toHaveBeenCalledTimes(1);
  });
});

describe('comboKeys', () => {
  it('splits a combo into the keys to show', () => {
    expect(comboKeys('mod+k')).toEqual([isMac ? '⌘' : 'Ctrl', 'K']);
    expect(comboKeys('g q')).toEqual(['g', 'q']);
    expect(comboKeys('?')).toEqual(['?']);
    expect(comboKeys('Escape')).toEqual(['Esc']);
    expect(comboKeys('Alt+ArrowUp')).toEqual(['Alt', '↑']);
  });
});
