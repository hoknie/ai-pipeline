// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElementHeight } from '../src/shared/lib/browser/useElementHeight.ts';

import { act, cleanup, render, screen } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useElementHeight', () => {
  function Probe({ element }: { element: Element | null }) {
    return <span>{`h=${useElementHeight(element)}`}</span>;
  }

  it('is 0 without ResizeObserver or without an element', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const element = document.createElement('div');
    render(<Probe element={element} />);
    expect(screen.getByText('h=0')).toBeTruthy();
    cleanup();
    vi.stubGlobal('ResizeObserver', class {});
    render(<Probe element={null} />);
    expect(screen.getByText('h=0')).toBeTruthy();
  });

  it('follows the height of the element, rounds it down and disconnects on unmount', () => {
    let notify: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    const element = document.createElement('div');
    let height = 48;
    element.getBoundingClientRect = () => ({ height }) as DOMRect;
    const { unmount } = render(<Probe element={element} />);
    expect(screen.getByText('h=48')).toBeTruthy();
    height = 71.2;
    act(() => notify());
    expect(screen.getByText('h=71')).toBeTruthy();
    height = 48.6;
    act(() => notify());
    expect(screen.getByText('h=48')).toBeTruthy();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
