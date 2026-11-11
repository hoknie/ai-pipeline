import { describe, expect, it } from 'vitest';

import {
  barLayout,
  columnTotals,
  foldSeries,
  niceTicks,
  OTHER_KEY,
  scaleValue,
  thinLabels,
  type ChartSeries,
} from '../src/shared/ui/charts/scale.ts';

const series = (key: string, values: number[]): ChartSeries => ({
  key,
  label: key,
  color: '#000',
  values,
});

describe('niceTicks', () => {
  it('rounds the axis up to a round value', () => {
    expect(niceTicks(87)).toEqual({ ticks: [0, 25, 50, 75, 100], max: 100 });
    expect(niceTicks(90_000).ticks[0]).toBe(0);
    expect(niceTicks(90_000).max).toBeGreaterThanOrEqual(90_000);
  });

  it('keeps four or five divisions', () => {
    for (const max of [1, 7, 13, 480, 90_000, 3_600_000]) {
      const { ticks } = niceTicks(max);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
  });

  it('gives a one-interval axis for no values', () => {
    expect(niceTicks(0)).toEqual({ ticks: [0, 1], max: 1 });
    expect(niceTicks(Number.NaN).max).toBe(1);
  });
});

describe('scaleValue', () => {
  it('maps a value to pixels and clamps', () => {
    expect(scaleValue(50, 100, 200)).toBe(100);
    expect(scaleValue(500, 100, 200)).toBe(200);
    expect(scaleValue(-1, 100, 200)).toBe(0);
    expect(scaleValue(5, 0, 200)).toBe(0);
  });
});

describe('barLayout', () => {
  it('centres every bar in an equal slot with a gap', () => {
    const slots = barLayout(100, 4);
    expect(slots).toHaveLength(4);
    expect(slots[1]?.slotX).toBe(25);
    expect(slots[0]?.width).toBeLessThan(25);
    const first = slots[0]!;
    expect(first.x - first.slotX).toBeCloseTo(25 - first.width - (first.x - first.slotX));
  });

  it('is empty without bars or width', () => {
    expect(barLayout(100, 0)).toEqual([]);
    expect(barLayout(0, 3)).toEqual([]);
  });
});

describe('thinLabels', () => {
  it('shows every label when there is room', () => {
    expect(thinLabels(5, 500, 40)).toEqual([0, 1, 2, 3, 4]);
  });

  it('skips labels so that they do not overlap', () => {
    const shown = thinLabels(30, 300, 44);
    expect(shown[0]).toBe(0);
    expect(shown.length).toBeLessThan(30);
    const step = (shown[1] ?? 0) - (shown[0] ?? 0);
    expect(step * (300 / 30)).toBeGreaterThanOrEqual(44);
  });
});

describe('foldSeries', () => {
  const other = { label: 'Other', color: '#999' };

  it('leaves up to the limit alone', () => {
    const input = [series('a', [1]), series('b', [2])];
    expect(foldSeries(input, 8, other)).toBe(input);
  });

  it('folds the smallest series into «Other»', () => {
    const input = Array.from({ length: 11 }, (_, index) =>
      series(`p${index}`, [index + 1, 0, index]),
    );
    const folded = foldSeries(input, 8, other);
    expect(folded).toHaveLength(9);
    expect(folded.map((item) => item.key).slice(0, 8)).toEqual([
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
      'p9',
      'p10',
    ]);
    const last = folded[8]!;
    expect(last.key).toBe(OTHER_KEY);
    expect(last.label).toBe('Other');
    // p0, p1, p2: 1+2+3 and 0+1+2
    expect(last.values).toEqual([6, 0, 3]);
  });
});

describe('columnTotals', () => {
  it('sums the series of every column', () => {
    expect(columnTotals([series('a', [1, 2]), series('b', [3])], 2)).toEqual([4, 2]);
  });
});
