import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

import type { Route } from './edgeRoutes.ts';
import { orthogonalPath } from './orthogonalPath.ts';

/** The data of an edge drawn along a route. */
export interface RouteData extends Record<string, unknown> {
  route?: Route | undefined;
}

/** The path of an edge: its route, or a straight line while there is none. */
export function pathOf(
  route: Route | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  return orthogonalPath(route?.points ?? [from, to]);
}

/** The look of the path of a chosen connection. */
export function edgeLook(selected: boolean | undefined, _selectable?: boolean | undefined) {
  return {
    ...(selected ? { style: { stroke: 'var(--color-primary)', strokeWidth: 2.5 } } : {}),
    'data-selected': selected ? 'true' : undefined,
  };
}

/** An angular edge along `data.route`, with its caption on a card-coloured background. */
export function OrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  selected,
  selectable,
}: EdgeProps) {
  const route = (data as RouteData | undefined)?.route;
  const at = route?.label ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  return (
    <>
      <BaseEdge
        id={id}
        path={pathOf(route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY })}
        {...(markerEnd ? { markerEnd } : {})}
        {...edgeLook(selected, selectable)}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            data-testid={`edge-label-${id}`}
            className="nodrag nopan absolute rounded border bg-card px-1 text-xs text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
