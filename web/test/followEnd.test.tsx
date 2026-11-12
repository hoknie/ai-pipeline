// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { useFollowEnd } from '../src/shared/lib/browser/useFollowEnd.ts';

import { act, cleanup, fireEvent, render, screen } from './render.tsx';

let resize: () => void = () => undefined;
const disconnect = vi.fn();

class FakeResizeObserver {
  constructor(cb: () => void) {
    resize = () => {
      if (!this.closed) cb();
    };
  }
  closed = false;
  observe() {}
  disconnect() {
    this.closed = true;
    disconnect();
  }
}

const scrollTo = vi.fn();

function Probe({ attach = true }: { attach?: boolean }) {
  const [content, setContent] = useState<HTMLElement | null>(null);
  const { following, follow } = useFollowEnd(attach ? content : null);
  return (
    <div>
      <div ref={setContent} data-testid="content" />
      <button onClick={follow}>go</button>
      <span>{String(following)}</span>
    </div>
  );
}

beforeEach(() => {
  resize = () => undefined;
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollTo');
  scrollTo.mockClear();
  disconnect.mockClear();
});

function start() {
  const view = render(<Probe />);
  fireEvent.click(screen.getByText('go'));
  scrollTo.mockClear();
  return view;
}

describe('useFollowEnd', () => {
  it('scrolls smoothly to the end on follow', () => {
    render(<Probe />);
    fireEvent.click(screen.getByText('go'));
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
    expect(screen.getByText('true')).toBeTruthy();
  });

  it('does not animate with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Probe />);
    fireEvent.click(screen.getByText('go'));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('scrolls again on growth only while following', () => {
    render(<Probe />);
    act(() => resize());
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('go'));
    scrollTo.mockClear();
    act(() => resize());
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wheel up', () => fireEvent.wheel(window, { deltaY: -10 })],
    ['ArrowUp', () => fireEvent.keyDown(window, { key: 'ArrowUp' })],
    ['PageUp', () => fireEvent.keyDown(window, { key: 'PageUp' })],
    ['Shift+Space', () => fireEvent.keyDown(window, { key: ' ', shiftKey: true })],
  ])('stops on %s', (_name, action) => {
    start();
    act(() => void action());
    expect(screen.getByText('false')).toBeTruthy();
    act(() => resize());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stops when scrollTop decreases, but not when it grows', () => {
    start();
    const root = document.documentElement;
    root.scrollTop = 500;
    act(() => void fireEvent.scroll(window));
    expect(screen.getByText('true')).toBeTruthy();
    root.scrollTop = 300;
    act(() => void fireEvent.scroll(window));
    expect(screen.getByText('false')).toBeTruthy();
    root.scrollTop = 0;
  });

  it('does not stop on wheel down', () => {
    start();
    act(() => void fireEvent.wheel(window, { deltaY: 10 }));
    expect(screen.getByText('true')).toBeTruthy();
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = start();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('is quiet without content or ResizeObserver', () => {
    const { unmount } = render(<Probe attach={false} />);
    fireEvent.click(screen.getByText('go'));
    unmount();
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe />);
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByText('true')).toBeTruthy();
  });
});
