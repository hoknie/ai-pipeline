import { describe, expect, it } from 'vitest';

import {
  CLEARANCE,
  FALLBACK_HEIGHT,
  FALLBACK_WIDTH,
  LANE_GAP,
  routeEdges,
  type Point,
  type Route,
  type RouteEdge,
  type RouteRect,
} from '../src/shared/lib/graph/edgeRoutes.ts';
import { orthogonalPath } from '../src/shared/lib/graph/orthogonalPath.ts';

const W = FALLBACK_WIDTH;
const H = FALLBACK_HEIGHT;
const rect = (id: string, x: number, y = 0): RouteRect => ({ id, x, y });
const row = (...ids: string[]): RouteRect[] => ids.map((id, at) => rect(id, at * 240));
const next = (source: string, target: string): RouteEdge => ({
  id: `next:${source}->${target}`,
  source,
  target,
  kind: 'next',
});
const back = (source: string, target: string): RouteEdge => ({
  id: `back:${source}->${target}`,
  source,
  target,
  kind: 'return',
});

const segments = (route: Route): [Point, Point][] =>
  route.points.slice(1).map((point, at) => [route.points[at]!, point]);
const inside = (point: Point, box: RouteRect): boolean =>
  point.x > box.x && point.x < box.x + W && point.y > box.y && point.y < box.y + H;
/** Whether a horizontal or vertical segment passes through the inside of a card. */
function crosses([from, to]: [Point, Point], box: RouteRect): boolean {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  return left < box.x + W && right > box.x && top < box.y + H && bottom > box.y;
}
const laneOf = (route: Route): number => route.points[1]!.y;

describe('orthogonalPath', () => {
  it('draws a straight segment without corners', () => {
    expect(
      orthogonalPath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ]),
    ).toBe('M 0 0 L 50 0');
  });

  it('rounds a corner with M, L and Q only', () => {
    const path = orthogonalPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
    ]);
    expect(path).toBe('M 0 0 L 44 0 Q 50 0 50 6 L 50 40');
    expect(path).not.toMatch(/C/);
  });

  it('takes no more than half of the shorter segment', () => {
    const path = orthogonalPath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 4 },
      ],
      6,
    );
    expect(path).toBe('M 0 0 L 48 0 Q 50 0 50 2 L 50 4');
  });
});

describe('routeEdges', () => {
  it('draws one horizontal segment between nodes in a row', () => {
    const routes = routeEdges(row('scan', 'report'), [next('scan', 'report')]);
    const route = routes.get('next:scan->report')!;
    expect(route.points).toEqual([
      { x: W, y: H / 2 },
      { x: 240, y: H / 2 },
    ]);
    expect(route.label).toEqual({ x: (W + 240) / 2, y: H / 2 });
  });

  it('goes right, down and right again to a node moved lower', () => {
    const rects = [rect('scan', 0), rect('report', 240, 200)];
    const route = routeEdges(rects, [next('scan', 'report')]).get('next:scan->report')!;
    expect(route.points).toHaveLength(4);
    expect(route.points[3]).toEqual({ x: 240, y: 200 + H / 2 });
    expect(route.points[0]!.x).toBeLessThan(route.points[1]!.x);
  });

  it('goes around both nodes when the next one is on the left', () => {
    const rects = [rect('scan', 300), rect('report', 0, 150)];
    const route = routeEdges(rects, [next('scan', 'report')]).get('next:scan->report')!;
    for (const part of segments(route))
      for (const box of rects) expect(crosses(part, box)).toBe(false);
    expect(route.points[route.points.length - 1]).toEqual({ x: 0, y: 150 + H / 2 });
  });

  it('puts the lane of a nested return above the enclosing one', () => {
    const rects = row('plan', 'code', 'review', 'qa');
    const routes = routeEdges(rects, [back('review', 'code'), back('qa', 'plan')]);
    const inner = routes.get('back:review->code')!;
    const outer = routes.get('back:qa->plan')!;
    expect(laneOf(inner)).toBeGreaterThanOrEqual(H + CLEARANCE);
    expect(laneOf(outer) - laneOf(inner)).toBeGreaterThanOrEqual(LANE_GAP);
  });

  it('enters one step at different points for two returns', () => {
    const rects = row('code', 'review', 'qa');
    const routes = routeEdges(rects, [back('review', 'code'), back('qa', 'code')]);
    const ends = ['back:review->code', 'back:qa->code'].map((id) => routes.get(id)!.points[3]!.x);
    expect(ends[0]).not.toBe(ends[1]);
    for (const x of ends) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(W / 2);
    }
  });

  it('keeps the lane 24 px under a node moved lower between the ends', () => {
    const rects = [rect('code', 0), rect('mid', 240, 150), rect('review', 480)];
    const route = routeEdges(rects, [back('review', 'code')]).get('back:review->code')!;
    expect(laneOf(route)).toBeGreaterThanOrEqual(150 + H + CLEARANCE);
  });

  it('does not overlap the captions of nested returns', () => {
    const rects = row('plan', 'code', 'review', 'qa');
    const routes = routeEdges(rects, [back('review', 'code'), back('qa', 'plan')]);
    const [a, b] = [...routes.values()].map((route) => route.label);
    // a caption is about 40 × 18 px
    const apart = Math.abs(a!.x - b!.x) >= 40 || Math.abs(a!.y - b!.y) >= 18;
    expect(apart).toBe(true);
    for (const label of [a!, b!]) {
      for (const box of rects) {
        expect(inside({ x: label.x, y: label.y }, box)).toBe(false);
        expect(label.y - 9).toBeGreaterThanOrEqual(box.y + H);
      }
    }
  });

  it('draws a vertical edge down, with one jog when the centres differ', () => {
    const edge: RouteEdge = { id: 'down', source: 'delivery', target: 'resolver', kind: 'down' };
    const straight = routeEdges([rect('delivery', 0), rect('resolver', 0, 150)], [edge]);
    expect(straight.get('down')!.points).toHaveLength(2);
    const jog = routeEdges([rect('delivery', 0), rect('resolver', 30, 150)], [edge]);
    expect(jog.get('down')!.points).toHaveLength(4);
  });

  it('uses only horizontal and vertical segments and is repeatable', () => {
    const rects = [rect('plan', 0), rect('code', 240, 120), rect('review', 480), rect('qa', 300)];
    const edges = [
      next('plan', 'code'),
      next('code', 'review'),
      next('review', 'qa'),
      back('review', 'code'),
      back('qa', 'plan'),
    ];
    const routes = routeEdges(rects, edges);
    for (const route of routes.values()) {
      for (const [from, to] of segments(route))
        expect(from.x === to.x || from.y === to.y).toBe(true);
    }
    expect(routeEdges(rects, edges)).toEqual(routes);
  });

  it('gives no route to an edge of an unknown node', () => {
    expect(routeEdges(row('a'), [next('a', 'ghost')]).size).toBe(0);
  });
});
