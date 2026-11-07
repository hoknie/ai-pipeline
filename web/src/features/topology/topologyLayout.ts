import type { Edge } from '@xyflow/react';
import type { TFunction } from 'i18next';

import type { MachineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import { pipelineStagesOf, type StagedTopology } from '../../shared/lib/pipeline/pipelineStages.ts';
import type { Live } from './liveState.ts';
import {
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
    className: 'edge-forward',
  };
}

const resolverEdge = (t: TFunction): Edge => ({
  id: 'delivery->resolver',
  source: 'delivery',
  target: 'resolver',
  sourceHandle: 'down',
  targetHandle: 'up',
  label: t('topology.conflict'),
  className: 'edge-resolver',
});

/** The back edges of the steps that can send the work to an earlier step. */
function rejectEdges(pipeline: StagedTopology): Edge[] {
  return pipeline.steps.flatMap((step) =>
    step.onReject
      ? [
          {
            id: `reject:${step.id}->${step.onReject.goto}`,
            source: `step:${step.id}`,
            target: `step:${step.onReject.goto}`,
            sourceHandle: 'back-out',
            targetHandle: 'back-in',
            type: 'smoothstep',
            label: `≤ ${step.onReject.maxRounds}`,
            className: 'edge-reject',
          },
        ]
      : [],
  );
}

/** Nodes left to right by the list of stages; the resolver under the delivery. */
export function layout(
  pipeline: StagedTopology,
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
  return { nodes, edges: [...edges, ...rejectEdges(pipeline)] };
}
