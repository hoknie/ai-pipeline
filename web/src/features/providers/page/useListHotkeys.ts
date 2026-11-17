import { useState } from 'react';

import { useHotkey } from '../../../shared/lib/browser/hotkeys.ts';
import type { ProviderRow } from '../list/ProvidersList.tsx';

/**
 * `j` and `k` move the selection along the rows, `Enter` opens the selected one. The keys of the
 * panel stay silent in fields and dialogs; `Enter` also leaves a focused button or link alone.
 */
export function useListHotkeys(
  rows: ProviderRow[],
  active: boolean,
  onOpen: (row: ProviderRow) => void,
): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const move = (step: -1 | 1) => {
    if (!active || rows.length === 0) return;
    const index = rows.findIndex((row) => row.key === current);
    const from = index < 0 ? (step > 0 ? -1 : rows.length) : index;
    const next = Math.min(rows.length - 1, Math.max(0, from + step));
    setCurrent(rows[next]!.key);
  };
  useHotkey('j', () => move(1));
  useHotkey('k', () => move(-1));
  useHotkey('Enter', (event) => {
    if (!active || current === null) return;
    if (event.target instanceof Element && event.target.closest('button, a, [role="tab"]')) return;
    const row = rows.find((item) => item.key === current);
    if (row) onOpen(row);
  });
  return current;
}
