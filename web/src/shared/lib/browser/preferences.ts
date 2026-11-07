import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'aip.web.';

function read<T>(key: string, initial: T): T {
  try {
    const stored = window.localStorage.getItem(PREFIX + key);
    return stored === null ? initial : (JSON.parse(stored) as T);
  } catch {
    return initial;
  }
}

/**
 * A setting of the person using the panel, kept in the browser between runs and page loads.
 * Without a usable localStorage it lives for the page only.
 * With `shared`, a change made by another tab of the same browser is followed.
 */
export function usePreference<T>(
  key: string,
  initial: T,
  options: { shared?: boolean } = {},
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));
  const shared = options.shared === true;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (!shared) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PREFIX + key) return;
      setValue(read(key, initialRef.current));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, shared]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Private mode or a full quota: the value still holds for this page.
      }
    },
    [key],
  );
  return [value, update];
}
