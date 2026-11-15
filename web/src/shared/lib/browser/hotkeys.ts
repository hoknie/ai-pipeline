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

const LETTER = /^[a-z]$/;

/** Whether the event is the key of the combo: letters by physical key, so any layout works. */
function keyMatches(key: string, event: KeyboardEvent): boolean {
  if (!LETTER.test(key)) return event.key === key;
  if (event.code) return event.code === `Key${key.toUpperCase()}`;
  return event.key.toLowerCase() === key;
}

function matches(combo: string, event: KeyboardEvent): boolean {
  if (combo.startsWith('mod+')) {
    return (
      (isMac() ? event.metaKey : event.ctrlKey) &&
      !event.altKey &&
      keyMatches(combo.slice(4), event)
    );
  }
  if (combo.startsWith('ctrl+')) {
    const key = combo.slice(5);
    return (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !(LETTER.test(key) && event.shiftKey) &&
      keyMatches(key, event)
    );
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (LETTER.test(combo) && event.shiftKey) return false;
  return keyMatches(combo, event);
}

/** The keys to show for a combo: `mod+k` → `⌘`, `K`; `ctrl+q` → `Ctrl`, `Q`. */
export function comboKeys(combo: string): string[] {
  if (combo.startsWith('mod+')) return [modLabel(), combo.slice(4).toUpperCase()];
  if (combo.startsWith('ctrl+')) return ['Ctrl', combo.slice(5).toUpperCase()];
  const shown: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓' };
  return combo.split(/ |\+/).map((key) => shown[key] ?? key);
}

function blockedByInput(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return Boolean(target?.closest(INPUT) || document.querySelector(OPEN_DIALOG));
}

/**
 * Runs the handler on a key (`j`, `?`), on `mod+k` (Cmd on macOS, Ctrl elsewhere) or on `ctrl+q`.
 * A plain key and a `ctrl+…` combo are ignored while typing and while a dialog is open;
 * `allowInInputs` (set for `mod+…`) lets it work in fields too.
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
      if (!allow && blockedByInput(event)) return;
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
