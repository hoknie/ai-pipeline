import type { Point } from './orthogonalPath.ts';
import { STUB, sideRoute, type Side } from './sideRoutes.ts';

export type { Point } from './orthogonalPath.ts';

export { STUB };
export type { Side };
/** The least distance of a lane of a return to the lower edge of a node. */
export const CLEARANCE = 24;
/** The least distance between the lanes of two returns that overlap. */
export const LANE_GAP = 20;
/** The size of a node that is not measured yet. */
export const FALLBACK_WIDTH = 208;
export const FALLBACK_HEIGHT = 90;

/** A node in the coordinates of the canvas; `y` is the top edge. */
export interface RouteRect {
  id: string;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
}

/** `next`: right edge to left edge; `return`: under the nodes; `down`: bottom edge to top edge. */
export interface RouteEdge {
  id: string;
  source: string;
  target: string;
  kind: 'next' | 'return' | 'down';
  /** The sides the ends are moved to; the sides of the kind when not set. */
  sourceSide?: Side | undefined;
  targetSide?: Side | undefined;
}

const DEFAULT_SIDES: Record<RouteEdge['kind'], [Side, Side]> = {
  next: ['right', 'left'],
  down: ['bottom', 'top'],
  return: ['bottom', 'bottom'],
};

/** The sides of an edge when one of them is not the one of its kind; `null` otherwise. */
function movedSides(edge: RouteEdge): [Side, Side] | null {
  const [source, target] = DEFAULT_SIDES[edge.kind];
  const sides: [Side, Side] = [edge.sourceSide ?? source, edge.targetSide ?? target];
  return sides[0] === source && sides[1] === target ? null : sides;
}

export interface Route {
  points: Point[];
  /** Where the caption and the plus of the edge stand. */
  label: Point;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const boxOf = (rect: RouteRect): Box => ({
  left: rect.x,
  right: rect.x + (rect.width ?? FALLBACK_WIDTH),
  top: rect.y,
  bottom: rect.y + (rect.height ?? FALLBACK_HEIGHT),
});

/** The middle of the longest horizontal segment; of the whole line when there is none. */
function labelOf(points: readonly Point[]): Point {
  let best: [Point, Point] | null = null;
  for (let at = 1; at < points.length; at++) {
    const from = points[at - 1]!;
    const to = points[at]!;
    if (from.y !== to.y) continue;
    if (!best || Math.abs(to.x - from.x) > Math.abs(best[1].x - best[0].x)) best = [from, to];
  }
  if (!best) {
    const from = points[0]!;
    const to = points[points.length - 1]!;
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }
  return { x: (best[0].x + best[1].x) / 2, y: best[0].y };
}

function stepRoute(from: Box, to: Box): Point[] {
  const sy = (from.top + from.bottom) / 2;
  const ty = (to.top + to.bottom) / 2;
  if (to.left - from.right >= 2 * STUB) {
    if (sy === ty)
      return [
        { x: from.right, y: sy },
        { x: to.left, y: ty },
      ];
    const mid = (from.right + to.left) / 2;
    return [
      { x: from.right, y: sy },
      { x: mid, y: sy },
      { x: mid, y: ty },
      { x: to.left, y: ty },
    ];
  }
  // too close or backwards: around both nodes, above them when the target is higher
  const lane =
    ty < sy ? Math.min(from.top, to.top) - CLEARANCE : Math.max(from.bottom, to.bottom) + CLEARANCE;
  const exit = Math.max(from.right, to.right) + STUB;
  const enter = Math.min(from.left, to.left) - STUB;
  return [
    { x: from.right, y: sy },
    { x: exit, y: sy },
    { x: exit, y: lane },
    { x: enter, y: lane },
    { x: enter, y: ty },
    { x: to.left, y: ty },
  ];
}

function downRoute(from: Box, to: Box): Point[] {
  const sx = (from.left + from.right) / 2;
  const tx = (to.left + to.right) / 2;
  if (sx === tx)
    return [
      { x: sx, y: from.bottom },
      { x: tx, y: to.top },
    ];
  const mid = (from.bottom + to.top) / 2;
  return [
    { x: sx, y: from.bottom },
    { x: sx, y: mid },
    { x: tx, y: mid },
    { x: tx, y: to.top },
  ];
}

interface Lane {
  edge: RouteEdge;
  from: Box;
  to: Box;
  left: number;
  right: number;
  y: number;
  out: number;
  into: number;
}

const overlaps = (a: Lane, b: Lane): boolean => a.left < b.right && b.left < a.right;
const contains = (outer: Lane, inner: Lane): boolean =>
  outer.left <= inner.left && inner.right <= outer.right;

/** The lanes of the returns: short ones first, each below its floor and the lanes it overlaps. */
function laneOf(boxes: Box[], lanes: Lane[]): void {
  const sorted = [...lanes].sort(
    (a, b) => a.right - a.left - (b.right - b.left) || (a.edge.id < b.edge.id ? -1 : 1),
  );
  const placed: Lane[] = [];
  for (const lane of sorted) {
    const floor = Math.max(
      ...boxes
        .filter((box) => box.left < lane.right && lane.left < box.right)
        .map((box) => box.bottom),
    );
    let min = floor + CLEARANCE;
    for (const other of placed) if (contains(lane, other)) min = Math.max(min, other.y + LANE_GAP);
    let y = min;
    for (let again = true; again;) {
      again = false;
      for (const other of placed) {
        if (overlaps(lane, other) && Math.abs(other.y - y) < LANE_GAP) {
          y = other.y + LANE_GAP;
          again = true;
        }
      }
    }
    lane.y = y;
    placed.push(lane);
  }
}

/** Spreads the ports of the returns along one half of the lower edge of a node. */
function portsOf(lanes: Lane[], side: 'out' | 'into', ascending: boolean): void {
  const groups = new Map<string, Lane[]>();
  for (const lane of lanes) {
    const key = side === 'out' ? lane.edge.source : lane.edge.target;
    groups.set(key, [...(groups.get(key) ?? []), lane]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (ascending ? a.y - b.y : b.y - a.y));
    const box = side === 'out' ? group[0]!.from : group[0]!.to;
    const width = box.right - box.left;
    group.forEach((lane, index) => {
      const share = (index + 1) / (group.length + 1);
      lane[side] =
        side === 'out'
          ? box.left + width / 2 + (width / 2) * share
          : box.left + (width / 2) * share;
    });
  }
}

function returnRoutes(boxes: Box[], lanes: Lane[], routes: Map<string, Route>): void {
  laneOf(boxes, lanes);
  portsOf(lanes, 'out', true);
  portsOf(lanes, 'into', false);
  for (const lane of lanes) {
    const points = [
      { x: lane.out, y: lane.from.bottom },
      { x: lane.out, y: lane.y },
      { x: lane.into, y: lane.y },
      { x: lane.into, y: lane.to.bottom },
    ];
    routes.set(lane.edge.id, { points, label: labelOf(points) });
  }
}

/**
 * The routes of the edges of a graph as polylines of horizontal and vertical segments. The result
 * depends only on the rectangles and the edges. Edges with an unknown node get no route.
 */
export function routeEdges(
  rects: readonly RouteRect[],
  edges: readonly RouteEdge[],
): Map<string, Route> {
  const boxes = new Map(rects.map((rect) => [rect.id, boxOf(rect)]));
  const routes = new Map<string, Route>();
  const lanes: Lane[] = [];
  for (const edge of edges) {
    const from = boxes.get(edge.source);
    const to = boxes.get(edge.target);
    if (!from || !to) continue;
    const moved = movedSides(edge);
    if (moved) {
      const points = sideRoute(from, moved[0], to, moved[1]);
      routes.set(edge.id, { points, label: labelOf(points) });
      continue;
    }
    if (edge.kind === 'return') {
      lanes.push({
        edge,
        from,
        to,
        left: Math.min(from.left, to.left),
        right: Math.max(from.right, to.right),
        y: 0,
        out: 0,
        into: 0,
      });
      continue;
    }
    const points = edge.kind === 'next' ? stepRoute(from, to) : downRoute(from, to);
    routes.set(edge.id, { points, label: labelOf(points) });
  }
  returnRoutes([...boxes.values()], lanes, routes);
  return routes;
}
