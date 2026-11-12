import { useEffect, useRef } from 'react';

/** The nearest ancestor that scrolls vertically; null when the page itself scrolls. */
export function scrollParent(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Calls `onReach` while the element is within 200px of the visible area of its scrolling container (or the viewport). The element is observed
 * again when `key` changes, so a marker that is still in view asks once more after new content.
 * Without the element or the API nothing happens.
 */
export function useNearEnd(
  element: Element | null,
  onReach: () => void,
  key: unknown = null,
): void {
  const callback = useRef(onReach);
  callback.current = onReach;
  useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last?.isIntersecting) callback.current();
      },
      { root: scrollParent(element), rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, key]);
}
