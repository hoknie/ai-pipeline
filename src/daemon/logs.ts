import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/** File next to an attempt's log with the time each log line was received. */
export function timesPath(logPath: string): string {
  return join(dirname(logPath), 'output.times');
}

/** Line number → moment (ms) from a times file; broken lines are skipped, no file is empty. */
export function readTimes(path: string): Map<number, number> {
  const times = new Map<number, number>();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return times;
  }
  for (const line of text.split('\n')) {
    const match = /^(\d+)\t(\d+)$/.exec(line);
    if (match && !times.has(Number(match[1]))) times.set(Number(match[1]), Number(match[2]));
  }
  return times;
}
