import { useEffect, useState } from 'react';

/** Height in pixels of the element, kept up to date; 0 without the element or ResizeObserver. */
export function useElementHeight(element: Element | null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}
