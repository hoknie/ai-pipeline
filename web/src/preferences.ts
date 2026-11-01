import { useCallback, useState } from 'react';

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
 */
export function usePreference<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));
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
