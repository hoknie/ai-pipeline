import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { routeEdges, type RouteEdge } from '../../../../shared/lib/graph/edgeRoutes.ts';
import type { ConfigEditorResponse } from '../../../../shared/api/types.ts';
import type { PipelineStage } from '../../../../shared/lib/pipeline/pipelineStages.ts';
import { stepIds } from '../../stepIds.ts';
import {
  CONFLICT_EDGE,
  draftGraph,
  type CanvasEdge,
  type CanvasNode as CanvasNodeType,
} from '../steps/draftGraph.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { edgeAnchorKey, type EdgeSides } from './canvasAnchors.ts';
import { layoutIdOf, placeNodes, snapPlace, type Layout } from './canvasLayout.ts';
import { followOf, pointLists, selectedNodeId, type Selection } from './canvasModel.ts';
import { useCanvasLayout } from './useCanvasLayout.ts';

/** The handles of the moved ends, so that the anchors of the flow stand where the route ends. */
function handlesOf(sides: EdgeSides | undefined) {
  return {
    ...(sides?.source ? { sourceHandle: sides.source } : {}),
    ...(sides?.target ? { targetHandle: sides.target } : {}),
  };
}

/** The id of the edge a selection marks. */
function chosenEdgeId(selection: Selection | null): string | null {
  if (selection?.kind === 'return') return `return:${selection.key}`;
  return selection?.kind === 'edge' ? selection.id : null;
}

/** The edges of the draft with their routes, the sides the ends were moved to, and the chosen one marked. */
function edgesOf(
  list: readonly CanvasEdge[],
  nodes: readonly CanvasNodeType[],
  selection: Selection | null,
  sidesOf: (edge: CanvasEdge) => EdgeSides | undefined,
  t: TFunction,
): CanvasEdge[] {
  const routes = routeEdges(
    nodes.map((item) => ({
      id: item.id,
      x: item.position.x,
      y: item.position.y,
      width: item.measured?.width,
      height: item.measured?.height,
    })),
    list.map((edge): RouteEdge => {
      const sides = sidesOf(edge);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.id.startsWith('return:')
          ? 'return'
          : edge.id === CONFLICT_EDGE
            ? 'down'
            : 'next',
        sourceSide: sides?.source,
        targetSide: sides?.target,
      };
    }),
  );
  const chosen = chosenEdgeId(selection);
  return list.map((edge) => ({
    ...edge,
    ...handlesOf(sidesOf(edge)),
    data: { ...(edge.data as NonNullable<typeof edge.data>), route: routes.get(edge.id) },
    ...(edge.id === CONFLICT_EDGE ? { label: t('topology.conflict') } : {}),
    selected: edge.id === chosen,
    // the pointer lands on the wide transparent path of the edge, so the hover goes through the wrapper
    ...(edge.id === chosen ? {} : { className: '[&:hover_.react-flow__edge-path]:stroke-2' }),
  }));
}

/** The nodes and edges of the draft, with the stages of the preview. */
function useDraftGraph(
  editor: ReturnType<typeof usePipelineEditor>,
  view: ConfigEditorResponse,
  editable: boolean,
) {
  const { draft, errors, id } = editor;
  const topology = editor.preview.topology;
  const previewStages: PipelineStage[] | null = topology ? (topology.stages ?? []) : null;
  const ids = useMemo(() => stepIds(draft.steps), [draft.steps]);
  const graph = useMemo(
    () =>
      draftGraph(draft, {
        pipelineId: id,
        ids,
        follow: followOf(view, draft),
        points: pointLists(draft, previewStages),
        stages: previewStages,
        errors,
        editable,
      }),
    // the preview stages come from the topology, the follow steps from the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, ids, id, errors, editable, view, topology],
  );
  return { ids, previewStages, graph };
}

/** The ids of the nodes a chosen connection joins. */
function endsOf(selection: Selection | null, list: readonly CanvasEdge[]): Set<string> {
  const chosen = chosenEdgeId(selection);
  const edge = list.find((candidate) => candidate.id === chosen);
  return new Set(edge ? [edge.source, edge.target] : []);
}

/**
 * The nodes on their places, the chosen one marked, with the sizes the flow measured: a node moved
 * by hand snaps to the grid; once the heights are known the nodes nobody placed stand on the line
 * of the edges.
 */
function useCanvasNodes(
  graphNodes: CanvasNodeType[],
  saved: Layout,
  markedId: string | null,
  ends: ReadonlySet<string>,
) {
  const mark = useCallback(
    (list: CanvasNodeType[]) =>
      list.map((item) => ({
        ...item,
        selected: item.id === markedId,
        data: { ...item.data, anchoring: ends.has(item.id) },
      })),
    [markedId, ends],
  );
  const [nodes, setNodes] = useState<CanvasNodeType[]>(() => placeNodes(graphNodes, saved));
  useEffect(() => {
    setNodes((current) => mark(placeNodes(graphNodes, saved, current)));
  }, [graphNodes, saved, mark]);
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNodeType>[]) =>
      setNodes((current) => {
        const snapped = changes.map((change) => {
          if (change.type !== 'position' || !change.dragging || !change.position) return change;
          const item = current.find((candidate) => candidate.id === change.id);
          return item ? { ...change, position: snapPlace(item, change.position) } : change;
        });
        const next = applyNodeChanges(snapped, current);
        return changes.some((change) => change.type === 'dimensions')
          ? mark(placeNodes(graphNodes, saved, next))
          : next;
      }),
    [graphNodes, saved, mark],
  );
  return { nodes, onNodesChange };
}

/**
 * The nodes and edges of the draft, with the selection marked and the sizes the flow measured.
 * The nodes stand where the person put them (`repository` and the id of the pipeline tell whose
 * layout it is); a node nobody moved stands in the automatic layout.
 */
export function useCanvasGraph(
  editor: ReturnType<typeof usePipelineEditor>,
  view: ConfigEditorResponse,
  repository: string,
  editable: boolean,
  selection: Selection | null,
) {
  const { ids, previewStages, graph } = useDraftGraph(editor, view, editable);
  const layout = useCanvasLayout(repository, editor.id, graph.nodes);
  const ends = useMemo(() => endsOf(selection, graph.edges), [selection, graph.edges]);
  const { nodes, onNodesChange } = useCanvasNodes(
    graph.nodes,
    layout.saved,
    selectedNodeId(selection),
    ends,
  );
  const { t } = useTranslation();
  const { anchors } = layout;
  const layoutIds = useMemo(
    () => new Map(graph.nodes.map((item) => [item.id, layoutIdOf(item)])),
    [graph.nodes],
  );
  /** The key under which the sides of a connection are remembered. */
  const anchorKeyOf = useCallback(
    (edge: { id: string; source: string; target: string }) =>
      edgeAnchorKey(
        edge.id,
        layoutIds.get(edge.source) ?? edge.source,
        layoutIds.get(edge.target) ?? edge.target,
      ),
    [layoutIds],
  );
  const edges = useMemo(
    () => edgesOf(graph.edges, nodes, selection, (edge) => anchors[anchorKeyOf(edge)], t),
    [graph.edges, nodes, selection, anchors, anchorKeyOf, t],
  );
  const { onDragStop: remember, arrange } = layout;
  /** Remembers where the node was dropped and where the others stand. */
  const onDragStop = useCallback(
    (dropped: CanvasNodeType) => remember(dropped, nodes),
    [remember, nodes],
  );
  return {
    ids,
    previewStages,
    nodes,
    edges,
    onNodesChange,
    onDragStop,
    arrange,
    anchorKeyOf,
    setAnchor: layout.setAnchor,
    resetAnchor: layout.resetAnchor,
  };
}
