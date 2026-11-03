import { useEffect, useState } from 'react';

import { usePreference } from './preferences.ts';

export const STATUS_BAR_DEFAULT_HEIGHT = 256;
export const STATUS_BAR_MIN_HEIGHT = 160;
export const STATUS_BAR_MAX_SHARE = 0.8;
export const STATUS_BAR_HEIGHT_STEP = 16;

/** The height of the open Status strip kept between 160 px and 80 % of the window (the window wins when it is smaller). */
export function clampStatusBarHeight(height: number, viewportHeight: number): number {
  const max = Math.floor(viewportHeight * STATUS_BAR_MAX_SHARE);
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
