// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clampStatusBarHeight,
  nextChosenHeight,
  statusBarMaxHeight,
  useStatusBarHeight,
} from '../src/statusBarHeight.ts';

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

describe('statusBarMaxHeight', () => {
  it.each([
    [900, 720],
    [150, 120],
  ])('is %i → %i', (viewport, expected) => {
    expect(statusBarMaxHeight(viewport)).toBe(expected);
  });
});

describe('nextChosenHeight', () => {
  it.each([
    [700, 480, 600, 700],
    [700, 464, 600, 464],
    [256, 272, 900, 272],
    [300, 720, 900, 720],
  ])('chosen %i, next %i, window %i → %i', (chosen, next, viewport, expected) => {
    expect(nextChosenHeight(chosen, next, viewport)).toBe(expected);
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
