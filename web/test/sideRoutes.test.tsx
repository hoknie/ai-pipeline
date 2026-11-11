import { describe, expect, it } from 'vitest';

import {
  FALLBACK_HEIGHT,
  FALLBACK_WIDTH,
  routeEdges,
  type Point,
  type RouteEdge,
  type RouteRect,
} from '../src/shared/lib/graph/edgeRoutes.ts';
import { portOf, sideRoute } from '../src/shared/lib/graph/sideRoutes.ts';

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

describe('routes by the chosen sides', () => {
  const from = { left: 0, right: 200, top: 0, bottom: 80 };
  const to = { left: 400, right: 600, top: 200, bottom: 280 };
  const axial = (points: Point[]) =>
    points.slice(1).every((point, at) => point.x === points[at]!.x || point.y === points[at]!.y);

  it('starts and ends at the middles of the sides, with axial segments', () => {
    for (const [fromSide, toSide] of [
      ['bottom', 'left'],
      ['right', 'top'],
      ['left', 'right'],
    ] as const) {
      const points = sideRoute(from, fromSide, to, toSide);
      expect(points[0]).toEqual(portOf(from, fromSide));
      expect(points[points.length - 1]).toEqual(portOf(to, toSide));
      expect(axial(points)).toBe(true);
    }
  });

  it('leaves a side along its normal', () => {
    const [start, next] = sideRoute(from, 'bottom', to, 'left');
    expect(next!.x).toBe(start!.x);
    expect(next!.y).toBeGreaterThan(start!.y);
  });

  it('does not repeat points or keep points on a straight segment', () => {
    expect(sideRoute(from, 'right', { ...from, left: 300, right: 500 }, 'left')).toEqual([
      { x: 200, y: 40 },
      { x: 300, y: 40 },
    ]);
  });

  it('routes an edge with a moved end by its sides and an edge without sides as before', () => {
    const rects = [rect('a', 0), rect('b', 240, 200)];
    const plain = routeEdges(rects, [next('a', 'b')]).get('next:a->b')!;
    const same = routeEdges(rects, [
      { ...next('a', 'b'), sourceSide: 'right', targetSide: 'left' },
    ]).get('next:a->b')!;
    expect(same).toEqual(plain);
    const moved = routeEdges(rects, [{ ...next('a', 'b'), sourceSide: 'bottom' }]).get(
      'next:a->b',
    )!;
    expect(moved.points[0]).toEqual({ x: W / 2, y: H });
    expect(moved.points[moved.points.length - 1]).toEqual({ x: 240, y: 200 + H / 2 });
  });

  it('keeps a moved return out of the lanes of the other returns', () => {
    const rects = row('a', 'b', 'c');
    const lanes = routeEdges(rects, [back('c', 'a')]).get('back:c->a')!;
    const both = routeEdges(rects, [back('c', 'a'), { ...back('b', 'a'), sourceSide: 'top' }]);
    expect(both.get('back:c->a')).toEqual(lanes);
  });
});
