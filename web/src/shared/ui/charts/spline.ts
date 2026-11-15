import { niceTicks, scaleValue, type ChartSeries, type Ticks } from './scale.ts';

export interface Point {
  x: number;
  y: number;
}

export interface ControlPoint {
  cp1: Point;
  cp2: Point;
}

export interface AreaLayer {
  series: ChartSeries;
  areaPath: string;
  strokePaths: string[];
  points: Point[];
}

/** Round divisions of the value axis with ~8% headroom over peak, or [0, 1] for 0. */
export function areaNiceTicks(peak: number, count = 4): Ticks {
  if (!Number.isFinite(peak) || peak <= 0) return { ticks: [0, 1], max: 1 };
  return niceTicks(peak * 1.08, count);
}

/**
 * Monotone cubic Hermite tangents using the Fritsch-Carlson algorithm.
 * Guarantees no overshoot on local extrema and preserves monotonicity on every segment.
 */
export function monotoneTangents(points: Point[]): number[] {
  const count = points.length;
  if (count <= 1) return count === 1 ? [0] : [];
  if (count === 2) {
    const dx = points[1]!.x - points[0]!.x;
    const slope = dx === 0 ? 0 : (points[1]!.y - points[0]!.y) / dx;
    return [slope, slope];
  }

  const secants: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = points[index + 1]!.x - points[index]!.x;
    secants.push(dx === 0 ? 0 : (points[index + 1]!.y - points[index]!.y) / dx);
  }

  const tangents: number[] = [secants[0]!];
  for (let index = 1; index < count - 1; index += 1) {
    const s0 = secants[index - 1]!;
    const s1 = secants[index]!;
    tangents.push((s0 > 0 && s1 > 0) || (s0 < 0 && s1 < 0) ? (s0 + s1) / 2 : 0);
  }
  tangents.push(secants[count - 2]!);

  for (let index = 0; index < count - 1; index += 1) {
    const delta = secants[index]!;
    if (Math.abs(delta) < 1e-9) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = tangents[index]! / delta;
    const beta = tangents[index + 1]! / delta;
    if (alpha < 0) tangents[index] = 0;
    if (beta < 0) tangents[index + 1] = 0;
    const dist = alpha * alpha + beta * beta;
    if (dist > 9) {
      const tau = 3 / Math.sqrt(dist);
      tangents[index] = tau * alpha * delta;
      tangents[index + 1] = tau * beta * delta;
    }
  }

  return tangents;
}

/** Cubic Bezier control points from points and monotonic tangents. */
export function cubicControlPoints(points: Point[], tangents: number[]): ControlPoint[] {
  const controls: ControlPoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index]!;
    const p1 = points[index + 1]!;
    const dx = (p1.x - p0.x) / 3;
    controls.push({
      cp1: { x: p0.x + dx, y: p0.y + (tangents[index] ?? 0) * dx },
      cp2: { x: p1.x - dx, y: p1.y - (tangents[index + 1] ?? 0) * dx },
    });
  }
  return controls;
}

const num = (value: number): string => Number(value.toFixed(2)).toString();

/** SVG path for a filled area bounded by top curve and bottom curve. */
export function buildAreaPath(
  topPoints: Point[],
  topControls: ControlPoint[],
  bottomPoints: Point[],
  bottomControls: ControlPoint[],
): string {
  const count = topPoints.length;
  if (count <= 1) return '';
  const first = topPoints[0]!;
  const parts: string[] = [`M ${num(first.x)} ${num(first.y)}`];

  for (let index = 0; index < count - 1; index += 1) {
    const cp = topControls[index]!;
    const pt = topPoints[index + 1]!;
    parts.push(
      `C ${num(cp.cp1.x)} ${num(cp.cp1.y)}, ${num(cp.cp2.x)} ${num(cp.cp2.y)}, ${num(pt.x)} ${num(pt.y)}`,
    );
  }

  const lastBottom = bottomPoints[count - 1]!;
  parts.push(`L ${num(lastBottom.x)} ${num(lastBottom.y)}`);

  for (let index = count - 2; index >= 0; index -= 1) {
    const cp = bottomControls[index]!;
    const pt = bottomPoints[index]!;
    parts.push(
      `C ${num(cp.cp2.x)} ${num(cp.cp2.y)}, ${num(cp.cp1.x)} ${num(cp.cp1.y)}, ${num(pt.x)} ${num(pt.y)}`,
    );
  }

  parts.push('Z');
  return parts.join(' ');
}

/** Nonzero stroke segments along the top boundary, skipping segments where both endpoints are zero. */
export function buildStrokePaths(
  points: Point[],
  controls: ControlPoint[],
  layerValues: number[],
): string[] {
  const count = points.length;
  if (count <= 1) return [];
  const paths: string[] = [];
  let current: string[] = [];

  for (let index = 0; index < count - 1; index += 1) {
    const active = (layerValues[index] ?? 0) > 0 || (layerValues[index + 1] ?? 0) > 0;
    if (active) {
      if (current.length === 0) {
        current.push(`M ${num(points[index]!.x)} ${num(points[index]!.y)}`);
      }
      const cp = controls[index]!;
      const pt = points[index + 1]!;
      current.push(
        `C ${num(cp.cp1.x)} ${num(cp.cp1.y)}, ${num(cp.cp2.x)} ${num(cp.cp2.y)}, ${num(pt.x)} ${num(pt.y)}`,
      );
    } else if (current.length > 0) {
      paths.push(current.join(' '));
      current = [];
    }
  }

  if (current.length > 0) {
    paths.push(current.join(' '));
  }
  return paths;
}

/**
 * Selects indexes of categories whose non-empty labels should be rendered,
 * preserving at least `minDistance` between adjacent rendered labels.
 */
export function thinCategoryLabels(
  categories: { label: string }[],
  xs: number[],
  minDistance: number,
): Set<number> {
  const shown = new Set<number>();
  let lastX = -Infinity;
  for (let index = 0; index < categories.length; index += 1) {
    const label = categories[index]?.label;
    if (!label || label.trim().length === 0) continue;
    const x = xs[index] ?? 0;
    if (x - lastX >= minDistance || lastX === -Infinity) {
      shown.add(index);
      lastX = x;
    }
  }
  return shown;
}

/** Computes x coordinates evenly spaced across plotWidth. */
export function categoryXPositions(count: number, plotWidth: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [plotWidth / 2];
  return Array.from({ length: count }, (_, index) => (index * plotWidth) / (count - 1));
}

/** Builds stacked area layers with monotone cubic Fritsch-Carlson interpolation. */
export function computeAreaLayers({
  series,
  count,
  plotWidth,
  plotHeight,
  max,
}: {
  series: ChartSeries[];
  count: number;
  plotWidth: number;
  plotHeight: number;
  max: number;
}): AreaLayer[] {
  if (count <= 0) return [];
  const xs = categoryXPositions(count, plotWidth);
  const layerCumulative: number[][] = [new Array<number>(count).fill(0)];

  series.forEach((part, sIdx) => {
    const prev = layerCumulative[sIdx]!;
    layerCumulative.push(prev.map((val, idx) => val + (part.values[idx] ?? 0)));
  });

  const layerCurves = layerCumulative.map((cumulative) => {
    const points = cumulative.map((val, idx) => ({
      x: xs[idx] ?? 0,
      y: plotHeight - scaleValue(val, max, plotHeight),
    }));
    const tangents = monotoneTangents(points);
    const controls = cubicControlPoints(points, tangents);
    return { points, tangents, controls };
  });

  return series.map((part, sIdx) => {
    const bottom = layerCurves[sIdx]!;
    const top = layerCurves[sIdx + 1]!;
    const areaPath = buildAreaPath(top.points, top.controls, bottom.points, bottom.controls);
    const strokePaths = buildStrokePaths(top.points, top.controls, part.values);
    return {
      series: part,
      areaPath,
      strokePaths,
      points: top.points,
    };
  });
}
