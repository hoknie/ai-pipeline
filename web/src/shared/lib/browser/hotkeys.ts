import { useEffect, useRef } from 'react';

const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const INPUT =
  'input, textarea, select, [role="combobox"], [contenteditable=""], [contenteditable="true"]';

/** Cmd on macOS, Ctrl elsewhere. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modLabel(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

function matches(combo: string, event: KeyboardEvent): boolean {
  if (combo.startsWith('mod+')) {
    return (
      (isMac() ? event.metaKey : event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === combo.slice(4)
    );
  }
  return !event.metaKey && !event.ctrlKey && !event.altKey && event.key === combo;
}

/**
 * Runs the handler on a key (`j`, `?`) or `mod+k`. A plain key is ignored while typing and while a
 * dialog is open; `allowInInputs` (set for `mod+…`) lets it work in fields too.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: { allowInInputs?: boolean } = {},
): void {
  const latest = useRef(handler);
  latest.current = handler;
  const allow = options.allowInInputs ?? combo.startsWith('mod+');
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!matches(combo, event)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!allow) {
        if (target?.closest(INPUT)) return;
        if (document.querySelector(OPEN_DIALOG)) return;
      }
      latest.current(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [combo, allow]);
}

let focusRequest: string | null = null;
const waiters = new Set<(name: string) => void>();

/** Asks the page to focus a named field; a field mounted later still gets the request. */
export function requestFocus(name: string): void {
  focusRequest = name;
  for (const waiter of waiters) waiter(name);
}

/** Subscribes a field; returns a pending request for it, if any, and clears it. */
export function takeFocusRequest(name: string, onRequest: () => void): () => void {
  const waiter = (requested: string) => {
    if (requested !== name) return;
    focusRequest = null;
    onRequest();
  };
  if (focusRequest === name) {
    focusRequest = null;
    onRequest();
  }
  waiters.add(waiter);
  return () => waiters.delete(waiter);
}
