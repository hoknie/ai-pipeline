// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOutOfView } from '../src/useOutOfView.ts';

import { act, cleanup, render, screen } from './render.tsx';

type Callback = (entries: { isIntersecting: boolean }[]) => void;

let callback: Callback = () => undefined;
const disconnect = vi.fn();

class FakeObserver {
  constructor(cb: Callback) {
    callback = cb;
  }
  observe() {}
  disconnect() {
    disconnect();
  }
}

function Probe({ element }: { element: Element | null }) {
  return <span>{String(useOutOfView(element))}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  disconnect.mockClear();
});

describe('useOutOfView', () => {
  it('is false at first, follows the observer and disconnects on unmount', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const element = document.createElement('div');
    const { unmount } = render(<Probe element={element} />);
    expect(screen.getByText('false')).toBeTruthy();
    act(() => callback([{ isIntersecting: false }]));
    expect(screen.getByText('true')).toBeTruthy();
    act(() => callback([{ isIntersecting: true }]));
    expect(screen.getByText('false')).toBeTruthy();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('is false without an element', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<Probe element={null} />);
    expect(screen.getByText('false')).toBeTruthy();
  });

  it('is false without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Probe element={document.createElement('div')} />);
    expect(screen.getByText('false')).toBeTruthy();
  });
});
