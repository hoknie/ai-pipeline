import { describe, expect, it } from 'vitest';

import {
  barLayout,
  columnTotals,
  foldSeries,
  niceTicks,
  OTHER_KEY,
  scaleValue,
  thinLabels,
  tipSeries,
  type ChartSeries,
} from '../src/shared/ui/charts/scale.ts';
import {
  areaNiceTicks,
  computeAreaLayers,
  cubicControlPoints,
  monotoneTangents,
  thinCategoryLabels,
} from '../src/shared/ui/charts/spline.ts';

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

describe('tipSeries', () => {
  it('orders by the value of the bucket, the largest first', () => {
    const input = [series('a', [1, 9]), series('b', [5, 2]), series('c', [3, 4])];
    expect(tipSeries(input, 0).map((item) => item.key)).toEqual(['b', 'c', 'a']);
    expect(tipSeries(input, 1).map((item) => item.key)).toEqual(['a', 'c', 'b']);
  });

  it('drops zero and missing values', () => {
    const input = [series('a', [0, 1]), series('b', [2]), series('c', [3, 0])];
    expect(tipSeries(input, 1).map((item) => item.key)).toEqual(['a']);
    expect(tipSeries(input, 0).map((item) => item.key)).toEqual(['c', 'b']);
  });

  it('keeps the order of the series on equal values, «Other» last', () => {
    const input = [series('a', [4]), series('b', [4]), series(OTHER_KEY, [4])];
    expect(tipSeries(input, 0).map((item) => item.key)).toEqual(['a', 'b', OTHER_KEY]);
  });

  it('does not change the input', () => {
    const input = [series('a', [1]), series('b', [2])];
    tipSeries(input, 0);
    expect(input.map((item) => item.key)).toEqual(['a', 'b']);
  });
});

describe('columnTotals', () => {
  it('sums the series of every column', () => {
    expect(columnTotals([series('a', [1, 2]), series('b', [3])], 2)).toEqual([4, 2]);
  });
});

describe('areaNiceTicks and Fritsch-Carlson spline', () => {
  it('calculates niceTicks with 8% headroom over peak, or [0, 1] for 0', () => {
    expect(areaNiceTicks(0)).toEqual({ ticks: [0, 1], max: 1 });
    expect(areaNiceTicks(-5)).toEqual({ ticks: [0, 1], max: 1 });
    const scaled = areaNiceTicks(100);
    expect(scaled.max).toBeGreaterThanOrEqual(108);
  });

  it('guarantees no overshoot on 0 -> N -> 0 transition', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 20 },
      { x: 100, y: 100 },
    ];
    const tangents = monotoneTangents(points);
    expect(tangents[1]).toBe(0);
    const controls = cubicControlPoints(points, tangents);

    const sample = (p0: number, c1: number, c2: number, p1: number, t: number) => {
      const mt = 1 - t;
      return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p1;
    };

    controls.forEach((ctrl, index) => {
      const p0 = points[index]!.y;
      const p1 = points[index + 1]!.y;
      for (let step = 0; step <= 10; step += 1) {
        const t = step / 10;
        const val = sample(p0, ctrl.cp1.y, ctrl.cp2.y, p1, t);
        expect(val).toBeGreaterThanOrEqual(20 - 1e-6);
        expect(val).toBeLessThanOrEqual(100 + 1e-6);
      }
    });
  });

  it('stacks layers seamlessly without gap between adjacent layers', () => {
    const s1 = series('s1', [10, 20, 15]);
    const s2 = series('s2', [5, 30, 10]);
    const layers = computeAreaLayers({
      series: [s1, s2],
      count: 3,
      plotWidth: 200,
      plotHeight: 100,
      max: 60,
    });
    expect(layers).toHaveLength(2);
    expect(layers[0]?.areaPath).toContain('M ');
    expect(layers[1]?.areaPath).toContain('M ');
    expect(layers[0]?.strokePaths).toHaveLength(1);
    expect(layers[1]?.strokePaths).toHaveLength(1);

    // The boundary dividing s1 and s2:
    // layers[0].points are the upper vertices of s1.
    // layers[1].areaPath must seamlessly trace along the exact same vertices for its baseline.
    const toCoord = (val: number) => Number(val.toFixed(2)).toString();
    const lastBoundaryPoint = layers[0]!.points[2]!;
    expect(layers[1]!.areaPath).toContain(
      `L ${toCoord(lastBoundaryPoint.x)} ${toCoord(lastBoundaryPoint.y)}`,
    );
    for (const pt of layers[0]!.points) {
      expect(layers[1]!.areaPath).toContain(`${toCoord(pt.x)} ${toCoord(pt.y)}`);
    }
  });

  it('handles single point mode without throwing or generating invalid paths', () => {
    const single = series('s', [50]);
    const layers = computeAreaLayers({
      series: [single],
      count: 1,
      plotWidth: 200,
      plotHeight: 100,
      max: 50,
    });
    expect(layers).toHaveLength(1);
    expect(layers[0]?.areaPath).toBe('');
    expect(layers[0]?.strokePaths).toEqual([]);
    expect(layers[0]?.points[0]?.x).toBe(100);
  });

  it('handles all zero series by omitting stroke segments', () => {
    const zeros = series('s', [0, 0, 0]);
    const layers = computeAreaLayers({
      series: [zeros],
      count: 3,
      plotWidth: 200,
      plotHeight: 100,
      max: 10,
    });
    expect(layers).toHaveLength(1);
    expect(layers[0]?.strokePaths).toEqual([]);
  });
});

describe('thinCategoryLabels', () => {
  it('preserves all midnight labels for a 7-day 6h series without skipping dates', () => {
    const categories = Array.from({ length: 28 }, (_, index) => ({
      label: index % 4 === 0 ? `Day ${index / 4 + 1}` : '',
    }));
    const xs = Array.from({ length: 28 }, (_, index) => (index * 640) / 27);
    const shown = thinCategoryLabels(categories, xs, 44 * 1.2);
    expect([...shown]).toEqual([0, 4, 8, 12, 16, 20, 24]);
  });

  it('thins labels if spacing is below minimum distance', () => {
    const categories = [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }];
    const xs = [0, 20, 40, 60];
    const shown = thinCategoryLabels(categories, xs, 50);
    expect([...shown]).toEqual([0, 3]);
  });

  it('keeps first non-empty label even if series starts mid-day', () => {
    const categories = [{ label: '' }, { label: '' }, { label: 'First Date' }, { label: '' }];
    const xs = [0, 25, 50, 75];
    const shown = thinCategoryLabels(categories, xs, 40);
    expect([...shown]).toEqual([2]);
  });
});
