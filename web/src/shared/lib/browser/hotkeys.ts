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
/** How long the second key of a sequence such as `g q` may follow the first. */
export const SEQUENCE_MS = 1500;

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
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (LETTER.test(combo) && event.shiftKey) return false;
  return keyMatches(combo, event);
}

/** The keys to show for a combo: `mod+k` → `⌘`, `K`; `g q` → `g`, `q`. */
export function comboKeys(combo: string): string[] {
  if (combo.startsWith('mod+')) return [modLabel(), combo.slice(4).toUpperCase()];
  const shown: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓' };
  return combo.split(/ |\+/).map((key) => shown[key] ?? key);
}

const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt']);
const firstKeys = new Map<string, number>();
let armed: { key: string; at: number } | null = null;
/** The first key of a sequence pressed right before the current event, if any. */
let prior: { key: string; at: number } | null = null;

function blockedByInput(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return Boolean(target?.closest(INPUT) || document.querySelector(OPEN_DIALOG));
}

function recent(entry: { at: number } | null): boolean {
  return entry !== null && Date.now() - entry.at <= SEQUENCE_MS;
}

// Runs before the hooks' listeners: remembers whether the previous key began a sequence.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      prior = armed;
      armed = null;
      if (blockedByInput(event)) return;
      for (const key of firstKeys.keys()) {
        if (matches(key, event)) armed = { key, at: Date.now() };
      }
    },
    true,
  );
}

function trackFirstKey(key: string): () => void {
  firstKeys.set(key, (firstKeys.get(key) ?? 0) + 1);
  return () => {
    const count = (firstKeys.get(key) ?? 1) - 1;
    if (count <= 0) firstKeys.delete(key);
    else firstKeys.set(key, count);
  };
}

/**
 * Runs the handler on a key (`j`, `?`), on `mod+k` or on a sequence (`g q`). A plain key is ignored
 * while typing and while a dialog is open; `allowInInputs` (set for `mod+…`) lets it work in fields
 * too. A single key does not fire right after the first key of a sequence.
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
    const [first, second] = combo.split(' ');
    const sequence = second !== undefined;
    const untrack = sequence && first ? trackFirstKey(first) : undefined;
    const listener = (event: KeyboardEvent) => {
      if (sequence) {
        if (!first || !second || !prior || prior.key !== first || !recent(prior)) return;
        if (!matches(second, event)) return;
      } else {
        if (!matches(combo, event)) return;
        if (recent(prior)) return;
      }
      if (!allow && blockedByInput(event)) return;
      latest.current(event);
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      untrack?.();
    };
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
