import { useEffect, useState } from 'react';

import { usePreference } from './preferences.ts';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'aip.web.theme';

function stored(): Theme {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as unknown;
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return darkQuery().matches ? 'dark' : 'light';
  return theme;
}

function apply(theme: Theme): 'light' | 'dark' {
  const resolved = resolve(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  return resolved;
}

/** Puts the saved theme on the page; called before the first render so the page does not flash. */
export function applyStoredTheme(): void {
  apply(stored());
}

export function useTheme(): {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
} {
  const [theme, setTheme] = usePreference<Theme>('theme', 'system');
  const [resolved, setResolved] = useState(() => resolve(theme));
  useEffect(() => {
    setResolved(apply(theme));
    if (theme !== 'system') return;
    const query = darkQuery();
    const follow = () => setResolved(apply('system'));
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [theme]);
  return { theme, resolved, setTheme };
}
