import { describe, expect, it } from 'vitest';

import { createInstance } from 'i18next';

import { en } from '../src/shared/i18n/locales/en.ts';
import { ru } from '../src/shared/i18n/locales/ru.ts';
import { formatBytes, progressPercent, runClockEnd, runTimes } from '../src/shared/lib/format.ts';

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

describe('runClockEnd', () => {
  it('stops a held run at the end of its last attempt', () => {
    const run = { finishedAt: null, finished: false, clockStoppedAt: 3_000 };
    expect(runClockEnd(run, 9_000)).toBe(3_000);
    expect(runTimes({ ...run, createdAt: 1_000 }, 99_000, 'en').duration).toBe(
      runTimes({ ...run, createdAt: 1_000 }, 9_000, 'en').duration,
    );
  });
  it('follows now without a stop, also when the field is absent', () => {
    expect(runClockEnd({ finishedAt: null, finished: false, clockStoppedAt: null }, 9_000)).toBe(
      9_000,
    );
    expect(runClockEnd({ finishedAt: null, finished: false }, 9_000)).toBe(9_000);
  });
  it('ends a finished run at its finish', () => {
    expect(runClockEnd({ finishedAt: 4_000, finished: true, clockStoppedAt: null }, 9_000)).toBe(
      4_000,
    );
  });
});

describe('formatBytes', () => {
  const i18n = createInstance({
    lng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru } },
  });
  void i18n.init();
  const t = i18n.getFixedT('en');
  it('shows bytes, KB and MB with one decimal', () => {
    expect(formatBytes(0, t, 'en')).toBe('0 B');
    expect(formatBytes(1023, t, 'en')).toBe('1023 B');
    expect(formatBytes(1536, t, 'en')).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024, t, 'en')).toBe('1 MB');
    expect(formatBytes(2.5 * 1024 * 1024, t, 'en')).toBe('2.5 MB');
  });
  it('speaks the language of the panel', () => {
    const ru = i18n.getFixedT('ru');
    expect(formatBytes(1536, ru, 'ru')).toBe('1,5 КБ');
    expect(formatBytes(5, ru, 'ru')).toBe('5 Б');
  });
});
