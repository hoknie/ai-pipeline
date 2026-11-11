import type { Point } from './orthogonalPath.ts';

/** The exit of an edge before it turns. */
export const STUB = 16;

/** A side of a node. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** A node as its four edges. */
export interface SideBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The port of a side: its middle. */
export function portOf(box: SideBox, side: Side): Point {
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;
  if (side === 'top') return { x, y: box.top };
  if (side === 'bottom') return { x, y: box.bottom };
  return { x: side === 'left' ? box.left : box.right, y };
}

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const horizontal = (side: Side): boolean => side === 'left' || side === 'right';

/** The line without repeated points and without the points that lie on a straight segment. */
function simplify(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    kept.push(point);
  }
  return kept.filter((point, at) => {
    const before = kept[at - 1];
    const after = kept[at + 1];
    if (!before || !after) return true;
    return !(
      (before.x === point.x && point.x === after.x) ||
      (before.y === point.y && point.y === after.y)
    );
  });
}

/**
 * The route between the ports of two chosen sides: out of the port by `STUB` along the normal of
 * the side, one or two turns (first along the axis of the exit of the source), into the target
 * along its normal. It does not go round other nodes.
 */
export function sideRoute(from: SideBox, fromSide: Side, to: SideBox, toSide: Side): Point[] {
  const start = portOf(from, fromSide);
  const end = portOf(to, toSide);
  const out = {
    x: start.x + NORMAL[fromSide].x * STUB,
    y: start.y + NORMAL[fromSide].y * STUB,
  };
  const into = { x: end.x + NORMAL[toSide].x * STUB, y: end.y + NORMAL[toSide].y * STUB };
  const corner = horizontal(fromSide) ? { x: into.x, y: out.y } : { x: out.x, y: into.y };
  return simplify([start, out, corner, into, end]);
}
