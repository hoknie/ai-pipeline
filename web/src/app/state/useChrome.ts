import { useEffect, useRef, useState } from 'react';

import { useHotkey } from '../../shared/lib/browser/hotkeys.ts';
import type { View } from '../../shared/lib/nav/route.ts';
import { useDrafts } from './useDrafts.ts';
import { useNewTask } from './useNewTask.ts';
import { useNow } from './routeState.ts';

/** Panel state that no page owns: the dialogs, the drafts, the clock and the unsaved-edits flag. */
export function useChrome(view: View) {
  /** Whether the open specialist or pipeline form has unsaved edits. */
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = false;
  }, [view]);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  useHotkey('mod+k', (event) => {
    event.preventDefault();
    setPalette((open) => !open);
  });
  useHotkey('?', () => setShortcuts(true));
  return {
    dirty,
    palette,
    setPalette,
    shortcuts,
    setShortcuts,
    newTask: useNewTask(),
    drafts: useDrafts(),
    now: useNow(),
  };
}
