// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeMenu } from '../src/app/shell/menus/ThemeMenu.tsx';
import { applyStoredTheme, useTheme } from '../src/shared/lib/browser/theme.ts';

import { TooltipProvider } from '../src/shared/ui/feedback/tooltip.tsx';

let dark = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  dark = false;
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme') ? dark : true;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  listeners.clear();
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('puts the dark class when «Dark» is chosen and keeps it after a remount', () => {
    const view = render(
      <TooltipProvider>
        <ThemeMenu />
      </TooltipProvider>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Theme/ }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    view.unmount();
    document.documentElement.classList.remove('dark');
    applyStoredTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('follows the system theme while «System» is on', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    dark = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores the system theme once a theme is chosen', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    dark = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
