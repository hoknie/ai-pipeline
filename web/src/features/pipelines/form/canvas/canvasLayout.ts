import type { CanvasNode } from '../steps/draftGraph.ts';

export interface Point {
  x: number;
  y: number;
}

/** The places of the nodes by their layout id; what the browser remembers. */
export type Layout = Record<string, Point>;

/** What the layout needs of a node: where it stands and how big the flow measured it. */
export interface Box {
  id: string;
  position: Point;
  measured?: { width?: number | undefined; height?: number | undefined } | undefined;
}

/** The step of the grid the nodes snap to: the left edge to a column, the line of the edges to a row. */
export const GRID = 20;
/** The line of the edges of the first row in the automatic layout: its distance to the top of a node of the fallback height. */
export const ROW_LINE = 40;
/** The space kept between a node and the one it was moved away from. */
export const GAP_Y = 40;
/** The sizes of a node the flow has not measured yet. */
export const FALLBACK_WIDTH = 200;
export const FALLBACK_HEIGHT = 80;

/** How many steps down are tried before the search moves to the next column. */
const ROWS = 20;

/** The id under which the browser remembers a node: the id of a step, the id of any other node. */
export function layoutIdOf(node: CanvasNode): string {
  return node.data.kind === 'step' && node.data.title !== '' ? node.data.title : node.id;
}

/** The places of the nodes in the automatic layout: the ones the draft gave them. */
export function autoLayout(nodes: readonly CanvasNode[]): Layout {
  return Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }]));
}

const sizeOf = (box: Box) => ({
  width: box.measured?.width ?? FALLBACK_WIDTH,
  height: box.measured?.height ?? FALLBACK_HEIGHT,
});

/** The height of the line the edges of a node leave it on: the middle of the node. */
const lineOf = (box: Box): number => box.position.y + sizeOf(box).height / 2;

/** The place on the grid nearest to `at`: the left edge on a column, the middle on a row. */
export function snapPlace(box: Box, at: Point): Point {
  const half = sizeOf(box).height / 2;
  return {
    x: Math.round(at.x / GRID) * GRID,
    y: Math.round((at.y + half) / GRID) * GRID - half,
  };
}

function overlaps(a: Box, at: Point, other: Box): boolean {
  const first = sizeOf(a);
  const second = sizeOf(other);
  return (
    at.x < other.position.x + second.width &&
    at.x + first.width > other.position.x &&
    at.y < other.position.y + second.height &&
    at.y + first.height > other.position.y
  );
}

/**
 * The place for a node dropped on others: its own when free, else the nearest free one below it
 * (every `GAP_Y`), and the next column to the right when the column below is full.
 */
export function resolveOverlap(node: Box, others: readonly Box[]): Point {
  const rest = others.filter((other) => other.id !== node.id);
  const blocked = (at: Point) => rest.some((other) => overlaps(node, at, other));
  const start = node.position;
  if (!blocked(start)) return { ...start };
  const columnWidth = Math.ceil((sizeOf(node).width + GAP_Y) / GRID) * GRID;
  for (let column = 0; column <= rest.length; column++) {
    for (let row = 0; row < ROWS; row++) {
      const at = { x: start.x + column * columnWidth, y: start.y + row * GAP_Y };
      if (!blocked(at)) return at;
    }
  }
  return { ...start };
}

/** The node a node stands next to in the automatic layout: the one before it, the delivery for the resolver. */
function anchorOf(nodes: readonly CanvasNode[], index: number): CanvasNode | undefined {
  const node = nodes[index] as CanvasNode;
  if (node.data.kind === 'resolver') return nodes.find((item) => item.data.kind === 'delivery');
  return nodes[index - 1];
}

/**
 * The nodes of the draft on their places. A node with a remembered place (`saved`, by node id) or
 * one that is being dragged stands on it. Any other node stands in the automatic layout next to the
 * node before it, wherever that one is, and moves off a node it would lie on.
 * `current` gives the sizes the flow measured and the nodes being dragged.
 */
export function placeNodes(
  nodes: readonly CanvasNode[],
  saved: Layout,
  current: readonly CanvasNode[] = [],
): CanvasNode[] {
  const known = new Map(current.map((node) => [node.id, node]));
  const auto = autoLayout(nodes);
  const placed = new Map<string, CanvasNode>();
  const withSize = (node: CanvasNode, position: Point): CanvasNode => {
    const measured = known.get(node.id)?.measured;
    return { ...node, position, ...(measured ? { measured } : {}) };
  };
  for (const node of nodes) {
    const dragged = known.get(node.id);
    const own = dragged?.dragging ? dragged.position : saved[node.id];
    if (own) placed.set(node.id, withSize(node, { ...own }));
  }
  for (const [index, node] of nodes.entries()) {
    if (placed.has(node.id)) continue;
    const anchor = anchorOf(nodes, index);
    const near = anchor ? placed.get(anchor.id) : undefined;
    const from = anchor ? auto[anchor.id] : undefined;
    const base = auto[node.id] as Point;
    // the automatic y is the line of the edges, not the top: the middle of the node stands on it
    const height = known.get(node.id)?.measured?.height ?? FALLBACK_HEIGHT;
    const line = near && from ? lineOf(near) + base.y - from.y : base.y + ROW_LINE;
    const x = near && from ? near.position.x + base.x - from.x : base.x;
    const box = withSize(node, { x, y: line - height / 2 });
    placed.set(node.id, { ...box, position: resolveOverlap(box, [...placed.values()]) });
  }
  return nodes.map((node) => placed.get(node.id) as CanvasNode);
}
