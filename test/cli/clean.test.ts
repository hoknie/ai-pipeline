import { describe, expect, it } from 'vitest';

import { formatCleanable } from '../../src/presentation/cli/local/clean.ts';
import { createStyle } from '../../src/presentation/format/index.ts';

const RUNS = [
  { id: 'run1', title: 'Первый', finishedAt: Date.UTC(2026, 0, 2, 12, 0), repository: '/r' },
  { id: 'run-longer', title: 'Второй', finishedAt: Date.UTC(2026, 0, 3, 12, 0), repository: '/r' },
];

describe('formatCleanable', () => {
  it('lists runs in aligned columns with a hint', () => {
    const lines = formatCleanable(RUNS).split('\n');
    expect(lines[0]).toMatch(/^RUN {9}FINISHED {10}TITLE$/);
    expect(lines[1]).toMatch(/^run1 {8}\d{4}-\d\d-\d\d \d\d:\d\d {2}Первый$/);
    expect(lines.slice(-2)).toEqual(['', 'To clean one: aip run clean <run-id>']);
    expect(formatCleanable([])).toBe('No finished runs to clean.');
  });

  it('highlights ids and mutes the hint with colors, keeping the columns', () => {
    const style = createStyle(true);
    const colored = formatCleanable(RUNS, style);
    expect(colored).toContain(style.accent('run1'));
    expect(colored).toContain(style.muted('To clean one: aip run clean <run-id>'));
    expect(colored.replace(/\x1b\[[0-9;]*m/g, '')).toBe(formatCleanable(RUNS));
  });
});
