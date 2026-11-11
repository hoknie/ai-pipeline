export interface Point {
  x: number;
  y: number;
}

/** The corner radius of the edges of the graphs. */
export const CORNER_RADIUS = 6;

const same = (left: Point, right: Point): boolean => left.x === right.x && left.y === right.y;

const length = (from: Point, to: Point): number =>
  Math.abs(to.x - from.x) + Math.abs(to.y - from.y);

/** The point at `distance` from `from` toward `to`. */
function toward(from: Point, to: Point, distance: number): Point {
  const total = length(from, to);
  if (total === 0) return from;
  return {
    x: from.x + ((to.x - from.x) * distance) / total,
    y: from.y + ((to.y - from.y) * distance) / total,
  };
}

/**
 * The SVG path of a polyline of horizontal and vertical segments with rounded corners:
 * `M`, `L` and `Q` only. A corner never takes more than half of a neighbouring segment.
 */
export function orthogonalPath(points: readonly Point[], radius: number = CORNER_RADIUS): string {
  const line = points.filter((point, index) => index === 0 || !same(point, points[index - 1]!));
  const first = line[0];
  if (!first) return '';
  let path = `M ${first.x} ${first.y}`;
  for (let at = 1; at < line.length; at++) {
    const point = line[at]!;
    const before = line[at - 1]!;
    const after = line[at + 1];
    if (!after) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }
    const r = Math.min(radius, length(before, point) / 2, length(point, after) / 2);
    const enter = toward(point, before, r);
    const leave = toward(point, after, r);
    path += ` L ${enter.x} ${enter.y} Q ${point.x} ${point.y} ${leave.x} ${leave.y}`;
  }
  return path;
}
