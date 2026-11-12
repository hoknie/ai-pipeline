import { useCallback, useEffect, useRef, useState } from 'react';

import { scrollParent } from './useNearEnd.ts';

function scrollerOf(content: Element | null): Element | null {
  if (!content) return null;
  return scrollParent(content) ?? document.scrollingElement ?? document.documentElement;
}

function behavior(): ScrollBehavior {
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 'auto' : 'smooth';
}

/**
 * Follow mode: scrolls the container of `content` smoothly to its end, again each time `content` grows. Any scrolling up by the user
 * (wheel, keys, touch, a smaller scrollTop) turns it off.
 */
export function useFollowEnd(content: Element | null): {
  following: boolean;
  follow: () => void;
  stop: () => void;
} {
  const [following, setFollowing] = useState(false);
  const contentRef = useRef(content);
  contentRef.current = content;
  const toEnd = useCallback(() => {
    const scroller = scrollerOf(contentRef.current);
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: behavior() });
  }, []);
  const follow = useCallback(() => {
    setFollowing(true);
    toEnd();
  }, [toEnd]);
  const stop = useCallback(() => setFollowing(false), []);

  useEffect(() => {
    if (!following || !content) return;
    const scroller = scrollerOf(content);
    if (!scroller) return;
    const target: EventTarget =
      scroller === document.scrollingElement || scroller === document.documentElement
        ? window
        : scroller;
    let last = scroller.scrollTop;
    const off = () => setFollowing(false);
    const onWheel = (event: Event) => {
      if ((event as WheelEvent).deltaY < 0) off();
    };
    const onKey = (event: Event) => {
      const key = event as KeyboardEvent;
      if (
        key.key === 'ArrowUp' ||
        key.key === 'PageUp' ||
        key.key === 'Home' ||
        (key.key === ' ' && key.shiftKey)
      ) {
        off();
      }
    };
    let touchY: number | null = null;
    const onTouchStart = (event: Event) => {
      touchY = (event as TouchEvent).touches[0]?.clientY ?? null;
    };
    const onTouch = (event: Event) => {
      const y = (event as TouchEvent).touches[0]?.clientY;
      if (y !== undefined && touchY !== null && y > touchY) off();
      if (y !== undefined) touchY = y;
    };
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (top < last - 1) off();
      last = top;
    };
    const listeners: [string, EventListener][] = [
      ['wheel', onWheel],
      ['keydown', onKey],
      ['touchstart', onTouchStart],
      ['touchmove', onTouch],
      ['scroll', onScroll],
    ];
    for (const [name, listener] of listeners) {
      target.addEventListener(name, listener, { passive: true });
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => toEnd());
    observer?.observe(content);
    return () => {
      for (const [name, listener] of listeners) target.removeEventListener(name, listener);
      observer?.disconnect();
    };
  }, [following, content, toEnd]);

  return { following, follow, stop };
}
