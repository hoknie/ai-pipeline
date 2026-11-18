export type KeyOutcome =
  | { done: false; text: string; tooLong?: false }
  | { done: true; text: string; cancelled: boolean; tooLong: boolean };

/**
 * Applies the keys of one raw-mode terminal chunk to the typed text: Backspace removes the last
 * character, Enter or Ctrl+D finishes, Ctrl+C cancels, other control characters and escape
 * sequences are ignored.
 */
export function applyKeys(text: string, chunk: string, limit: number): KeyOutcome {
  let current = text;
  const keys = Array.from(chunk);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string;
    if (key === '\r' || key === '\n' || key === '\u0004') {
      return { done: true, text: current, cancelled: false, tooLong: false };
    }
    if (key === '\u0003') return { done: true, text: '', cancelled: true, tooLong: false };
    if (key === '\u007f' || key === '\b') {
      current = Array.from(current).slice(0, -1).join('');
      continue;
    }
    if (key === '\u001b') {
      // An escape sequence (arrows, Delete, ...): skip it up to its final letter or `~`.
      if (keys[i + 1] === '[' || keys[i + 1] === 'O') {
        i += 2;
        while (i < keys.length && !/[A-Za-z~]/.test(keys[i] as string)) i += 1;
      }
      continue;
    }
    if (key < ' ' || (key >= '\u007f' && key <= '\u009f')) continue;
    current += key;
    if (Buffer.byteLength(current) > limit) {
      return { done: true, text: '', cancelled: false, tooLong: true };
    }
  }
  return { done: false, text: current };
}
