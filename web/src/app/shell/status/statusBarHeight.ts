import { useEffect, useState } from 'react';

import { usePreference } from '../../../shared/lib/browser/preferences.ts';

export const STATUS_BAR_DEFAULT_HEIGHT = 256;
export const STATUS_BAR_MIN_HEIGHT = 160;
export const STATUS_BAR_MAX_SHARE = 0.8;
export const STATUS_BAR_HEIGHT_STEP = 16;

/** The tallest the strip may be in a window of this height. */
export function statusBarMaxHeight(viewportHeight: number): number {
  return Math.floor(viewportHeight * STATUS_BAR_MAX_SHARE);
}

/** The height to remember after a user action: an action that only hit the shrunk window's limit keeps the larger chosen height. */
export function nextChosenHeight(chosen: number, next: number, viewportHeight: number): number {
  return next >= statusBarMaxHeight(viewportHeight) && chosen > next ? chosen : next;
}

/** The height of the open Status strip kept between 160 px and 80 % of the window (the window wins when it is smaller). */
export function clampStatusBarHeight(height: number, viewportHeight: number): number {
  const max = statusBarMaxHeight(viewportHeight);
  return Math.max(Math.min(height, max), Math.min(STATUS_BAR_MIN_HEIGHT, max));
}

/** The inner height of the window, following its resizing. */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

/** The chosen height (remembered), the height to show now and the viewport it is limited by. */
export function useStatusBarHeight(): {
  height: number;
  chosen: number;
  viewportHeight: number;
  setChosen: (height: number) => void;
} {
  const [chosen, setChosen] = usePreference<number>('statusBar.height', STATUS_BAR_DEFAULT_HEIGHT);
  const viewportHeight = useViewportHeight();
  const valid = Number.isFinite(chosen) ? chosen : STATUS_BAR_DEFAULT_HEIGHT;
  return {
    height: clampStatusBarHeight(valid, viewportHeight),
    chosen: valid,
    viewportHeight,
    setChosen,
  };
}

/** The change of height by an arrow key; 0 for any other key. */
export function keyDelta(key: string): number {
  if (key === 'ArrowUp') return STATUS_BAR_HEIGHT_STEP;
  return key === 'ArrowDown' ? -STATUS_BAR_HEIGHT_STEP : 0;
}

/** The remembered height after an arrow key moved the shown one by `delta`. */
export function chosenAfterKey(
  chosen: number,
  height: number,
  delta: number,
  viewportHeight: number,
): number {
  return nextChosenHeight(
    chosen,
    clampStatusBarHeight(height + delta, viewportHeight),
    viewportHeight,
  );
}
