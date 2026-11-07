import type { Edge } from '@xyflow/react';

import type { Size, StageNode } from './topologyTypes.ts';

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Nodes for React Flow: a node whose position, selection and data did not change keeps its
 * previous object; a changed one is new but carries the last measured size, so React Flow
 * does not hide it until it is measured again.
 */
export function stabilize(
  previous: readonly StageNode[],
  next: readonly StageNode[],
  sizes: ReadonlyMap<string, Size>,
  selected: string | null,
): StageNode[] {
  const before = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const isSelected = node.id === selected;
    const old = before.get(node.id);
    if (
      old &&
      old.position.x === node.position.x &&
      old.position.y === node.position.y &&
      Boolean(old.selected) === isSelected &&
      sameJson(old.data, node.data)
    ) {
      return old;
    }
    const size = sizes.get(node.id) ?? old?.measured;
    return { ...node, selected: isSelected, ...(size ? { measured: { ...size } } : {}) };
  });
}

export function stabilizeEdges(previous: readonly Edge[], next: readonly Edge[]): Edge[] {
  const before = new Map(previous.map((edge) => [edge.id, edge]));
  return next.map((edge) => {
    const old = before.get(edge.id);
    return old && sameJson(old, edge) ? old : edge;
  });
}
