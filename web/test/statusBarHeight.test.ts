// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { clampStatusBarHeight, useStatusBarHeight } from '../src/statusBarHeight.ts';

const setWindow = (height: number) => {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
});

describe('clampStatusBarHeight', () => {
  it.each([
    [256, 900, 256],
    [9999, 900, 720],
    [10, 900, 160],
    [700, 600, 480],
    [256, 150, 120],
  ])('%i in a window of %i is %i', (height, viewport, expected) => {
    expect(clampStatusBarHeight(height, viewport)).toBe(expected);
  });
});

describe('useStatusBarHeight', () => {
  it('shrinks with the window and returns to the chosen height', () => {
    window.localStorage.setItem('aip.web.statusBar.height', '700');
    const { result } = renderHook(() => useStatusBarHeight());
    expect(result.current.height).toBe(700);
    act(() => setWindow(600));
    expect(result.current.height).toBe(480);
    act(() => setWindow(900));
    expect(result.current.height).toBe(700);
  });
});
