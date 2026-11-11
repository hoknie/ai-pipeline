import type { Edge } from '@xyflow/react';
import type { TFunction } from 'i18next';

import { routeEdges, type RouteEdge } from '../../shared/lib/graph/edgeRoutes.ts';
import type { MachineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import { pipelineStagesOf } from '../../shared/lib/pipeline/pipelineStages.ts';
import type { PipelineTopology } from '../../shared/api/types.ts';
import type { Live } from './liveState.ts';
import {
  FALLBACK_HEIGHT,
  FALLBACK_WIDTH,
  commonOf,
  mainNode,
  resolverNode,
  type NodeContext,
  type NodeSpec,
} from './topologyNodes.ts';
import type { Size, StageNode } from './topologyTypes.ts';

export { liveState, type Live, type LiveGroup } from './liveState.ts';
export { stabilize, stabilizeEdges } from './topologyStable.ts';
export { FALLBACK_HEIGHT, RESOLVER_GAP, otherUse } from './topologyNodes.ts';
export type { Busy, Size, StageData, StageNode } from './topologyTypes.ts';

const GAP = 210;

/** The edge between two nodes of the main line. */
function forward(from: StageNode, spec: NodeSpec): Edge {
  return {
    id: `${from.id}->${spec.id}`,
    source: from.id,
    target: spec.id,
    sourceHandle: 'out',
    targetHandle: 'in',
    animated: spec.data.active,
    type: 'orthogonal',
    className: 'edge-forward',
  };
}

const resolverEdge = (t: TFunction): Edge => ({
  id: 'delivery->resolver',
  source: 'delivery',
  target: 'resolver',
  sourceHandle: 'down',
  targetHandle: 'up',
  type: 'orthogonal',
  label: t('topology.conflict'),
  className: 'edge-resolver',
});

/** The back edges of the steps that can send the work to an earlier step. */
function rejectEdges(pipeline: PipelineTopology): Edge[] {
  return pipeline.steps.flatMap((step) =>
    step.onReject
      ? [
          {
            id: `reject:${step.id}->${step.onReject.goto}`,
            source: `step:${step.id}`,
            target: `step:${step.onReject.goto}`,
            sourceHandle: 'back-out',
            targetHandle: 'back-in',
            type: 'orthogonal',
            label: `≤ ${step.onReject.maxRounds}`,
            className: 'edge-reject',
          },
        ]
      : [],
  );
}

/** Nodes left to right by the list of stages; the resolver under the delivery. */
export function layout(
  pipeline: PipelineTopology,
  live: Live,
  t: TFunction,
  sizes: ReadonlyMap<string, Size> = new Map(),
  load: MachineLoad = new Map(),
): { nodes: StageNode[]; edges: Edge[] } {
  const ctx: NodeContext = { pipeline, live, load, t, sizes };
  const nodes: StageNode[] = [];
  const edges: Edge[] = [];
  let last: StageNode | null = null;
  let previous: StageNode['data']['section'] | null = null;
  for (const stage of pipelineStagesOf(pipeline)) {
    const common = commonOf(stage, previous, t);
    if (stage.kind === 'resolve') {
      const spec = resolverNode(
        ctx,
        stage,
        common,
        nodes.find((node) => node.id === 'delivery'),
      );
      if (!spec) continue;
      nodes.push({ id: spec.id, type: 'stage', position: spec.position, data: spec.data });
      edges.push(resolverEdge(t));
      continue;
    }
    const spec = mainNode(ctx, stage, common);
    if (!spec) continue;
    // The resolver is not on the main line, so `last` skips it.
    const node: StageNode = {
      id: spec.id,
      type: 'stage',
      position: { x: nodes.filter((item) => item.id !== 'resolver').length * GAP, y: 0 },
      data: spec.data,
    };
    nodes.push(node);
    previous = spec.data.section;
    if (last) edges.push(forward(last, spec));
    last = node;
  }
  const all = [...edges, ...rejectEdges(pipeline)];
  return { nodes, edges: routed(nodes, all, sizes) };
}

/** The edges with the routes along which they are drawn; the nodes stand by their middle left. */
function routed(nodes: StageNode[], edges: Edge[], sizes: ReadonlyMap<string, Size>): Edge[] {
  const routes = routeEdges(
    nodes.map((node) => {
      const size = sizes.get(node.id);
      const height = size?.height ?? FALLBACK_HEIGHT;
      return {
        id: node.id,
        x: node.position.x,
        y: node.position.y - height / 2,
        width: size?.width ?? FALLBACK_WIDTH,
        height,
      };
    }),
    edges.map((edge): RouteEdge => {
      const kind = edge.id.startsWith('reject:')
        ? 'return'
        : edge.id === 'delivery->resolver'
          ? 'down'
          : 'next';
      return { id: edge.id, source: edge.source, target: edge.target, kind };
    }),
  );
  return edges.map((edge) => ({ ...edge, data: { route: routes.get(edge.id) } }));
}
