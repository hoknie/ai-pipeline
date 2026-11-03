import { useEffect, useState } from 'react';

/** True while the element is entirely scrolled out of the viewport; false without the element or the API. */
export function useOutOfView(element: Element | null): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') {
      setOut(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setOut(!last.isIntersecting);
      },
      { threshold: 0, root: null },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setOut(false);
    };
  }, [element]);
  return out;
}
