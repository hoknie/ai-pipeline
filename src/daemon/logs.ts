import { closeSync, openSync, readSync, statSync } from 'node:fs';

const TAIL_BYTES = 256 * 1024;

const LOG_BYTES = 32 * 1024 * 1024;

/** Complete lines of a log from line `after` on; a trailing partial line is left for later. */
export function readLines(path: string, after: number): { lines: string[]; cursor: number } {
  let text: string;
  try {
    const size = statSync(path).size;
    const descriptor = openSync(path, 'r');
    try {
      const length = Math.min(size, LOG_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(descriptor, buffer, 0, length, 0);
      text = buffer.toString('utf8');
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { lines: [], cursor: after };
  }
  const all = text.split('\n');
  all.pop();
  return { lines: all.slice(after), cursor: Math.max(after, all.length) };
}

export function readTail(path: string, lines: number): string[] {
  let descriptor: number;
  try {
    descriptor = openSync(path, 'r');
  } catch {
    return [];
  }
  try {
    const size = statSync(path).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    const text = buffer.toString('utf8').replace(/\n$/, '');
    return text === '' ? [] : text.split('\n').slice(-lines);
  } finally {
    closeSync(descriptor);
  }
}
