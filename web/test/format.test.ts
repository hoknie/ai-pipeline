import { describe, expect, it } from 'vitest';

import { progressPercent, runTimes } from '../src/format.ts';

describe('progressPercent', () => {
  it('rounds the share of passed steps', () => {
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent({ done: 1, total: 4 })).toBe(25);
    expect(progressPercent({ done: 2, total: 3 })).toBe(67);
    expect(progressPercent({ done: 4, total: 4 })).toBe(100);
    expect(progressPercent({ done: 5, total: 4 })).toBe(100);
  });
});

describe('runTimes', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 10, h, m).getTime();
  it('counts an unfinished run up to now', () => {
    const run = { createdAt: at(10), finishedAt: null, finished: false };
    expect(runTimes(run, at(10, 5), 'en').duration).toBe('5m00s');
  });
  it('counts a finished run up to its end', () => {
    const run = { createdAt: at(10), finishedAt: at(10, 2), finished: true };
    expect(runTimes(run, at(12), 'en').duration).toBe('2m00s');
  });
  it('adds the date for another day', () => {
    const run = { createdAt: at(10), finishedAt: null, finished: false };
    const next = new Date(2026, 0, 11, 9).getTime();
    expect(runTimes(run, next, 'en').created).toMatch(/\d\d\/\d\d|\d\d\.\d\d/);
  });
});
