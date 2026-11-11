import { SIDES, type Side } from '../../../../shared/lib/graph/sideRoutes.ts';
import type { Draft } from '../steps/draft.ts';
import { canReturn, stepKeyOfNode } from '../steps/draftOps.ts';

/** The sides the ends of one connection are moved to. */
export interface EdgeSides {
  source?: Side;
  target?: Side;
}

/** The moved ends of the connections by the key of a connection; what the browser remembers. */
export type Anchors = Record<string, EdgeSides>;

/** The key of the browser setting that holds the sides of the connections of one pipeline. */
export const anchorsKey = (repository: string, pipelineId: string): string =>
  `canvasAnchors.${repository}.${pipelineId}`;

/** The key of a connection by the layout ids of its nodes; a return has its own prefix. */
export function edgeAnchorKey(edgeId: string, source: string, target: string): string {
  return `${edgeId.startsWith('return:') ? 'return:' : ''}${source}->${target}`;
}

/** The side a handle id of a node stands for, if it is one. */
export const sideOfHandle = (handle: string | null | undefined): Side | undefined =>
  SIDES.find((side) => side === handle);

/** The anchors with the given sides of a connection set; the other end keeps its side. */
export function withAnchor(anchors: Anchors, key: string, sides: EdgeSides): Anchors {
  const next = { ...anchors[key], ...sides };
  return next.source || next.target ? { ...anchors, [key]: next } : anchors;
}

/** The anchors without a connection. */
export function withoutAnchor(anchors: Anchors, key: string): Anchors {
  if (!(key in anchors)) return anchors;
  const { [key]: _gone, ...rest } = anchors;
  return rest;
}

/** What a dragged end of a connection changes. */
export type ReconnectOutcome =
  | { kind: 'sides'; sides: EdgeSides }
  | { kind: 'goto'; source: string; target: string; targetSide: Side | undefined };

interface Ends {
  source: string;
  target: string;
}

/**
 * What dropping an end of `oldEdge` on a handle does: the same two nodes mean new sides of the
 * ends; the end of an own return on another step means a new `goto` (when it is allowed);
 * anything else changes nothing, the edge goes back to where the draft puts it.
 */
export function reconnectOutcome(
  oldEdge: Ends & { id: string },
  connection: Ends & { sourceHandle?: string | null; targetHandle?: string | null },
  draft: Draft,
  editable: boolean,
): ReconnectOutcome | null {
  const sourceSide = sideOfHandle(connection.sourceHandle);
  const targetSide = sideOfHandle(connection.targetHandle);
  if (connection.source === oldEdge.source && connection.target === oldEdge.target) {
    if (!sourceSide && !targetSide) return null;
    return {
      kind: 'sides',
      sides: {
        ...(sourceSide ? { source: sourceSide } : {}),
        ...(targetSide ? { target: targetSide } : {}),
      },
    };
  }
  const from = stepKeyOfNode(oldEdge.source);
  const to = stepKeyOfNode(connection.target);
  if (!editable || !oldEdge.id.startsWith('return:') || connection.source !== oldEdge.source) {
    return null;
  }
  if (from === null || to === null || !canReturn(draft, from, to)) return null;
  return { kind: 'goto', source: connection.source, target: connection.target, targetSide };
}
