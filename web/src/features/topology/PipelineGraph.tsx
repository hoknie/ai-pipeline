import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PipelineTopology } from '../../shared/api/types.ts';

import { OrthogonalEdge } from '../../shared/lib/graph/OrthogonalEdge.tsx';
import { cn } from '../../shared/lib/browser/cn.ts';
import type { MachineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import { useTheme } from '../../shared/lib/browser/theme.ts';
import { Stage } from './StageCard.tsx';
import {
  layout,
  liveState,
  stabilize,
  stabilizeEdges,
  type Live,
  type Size,
  type StageNode,
} from './topologyLayout.ts';

const FIT_OPTIONS = { padding: 0.15, maxZoom: 1 };
const NODE_ORIGIN: [number, number] = [0, 0.5];

/** Fits the view when another pipeline is opened, not on live updates. */
function FitOnSwitch({ pipeline }: { pipeline: string }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!initialized || fitted.current === pipeline) return;
    if (fitted.current !== null) void fitView(FIT_OPTIONS);
    fitted.current = pipeline;
  }, [initialized, pipeline, fitView]);
  return null;
}

const NODE_TYPES = { stage: Stage };
const EDGE_TYPES = { orthogonal: OrthogonalEdge };

/**
 * The graph of a pipeline. With `live` the nodes carry the groups of active runs; without it
 * the graph is the plain scheme, as the editor previews it.
 */
export function PipelineGraph({
  pipeline,
  live,
  load,
  selected = null,
  onSelect,
  onNodes,
  className,
}: {
  pipeline: PipelineTopology;
  live?: Live | null;
  /** Load of the specialists across the machine; without it nodes show no occupancy. */
  load?: MachineLoad | null;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Called with the laid out nodes whenever they change. */
  onNodes?: (nodes: StageNode[]) => void;
  /** Extra classes of the container, e.g. another height than the default 420px. */
  className?: string;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const state = useMemo(() => live ?? liveState(pipeline, [], null), [live, pipeline]);
  const sizes = useRef(new Map<string, Size>());
  const [sizeVersion, setSizeVersion] = useState(0);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let changed = false;
    for (const change of changes) {
      if (change.type !== 'dimensions' || !change.dimensions) continue;
      const known = sizes.current.get(change.id);
      const { width, height } = change.dimensions;
      if (known && known.width === width && known.height === height) continue;
      sizes.current.set(change.id, { width, height });
      changed = true;
    }
    if (changed) setSizeVersion((version) => version + 1);
  }, []);
  const previousNodes = useRef<StageNode[]>([]);
  const previousEdges = useRef<Edge[]>([]);
  const graph = useMemo(() => {
    void sizeVersion;
    const raw = layout(pipeline, state, t, sizes.current, load ?? undefined);
    const nodes = stabilize(previousNodes.current, raw.nodes, sizes.current, selected);
    const edges = stabilizeEdges(previousEdges.current, raw.edges);
    previousNodes.current = nodes;
    previousEdges.current = edges;
    return { nodes, edges };
  }, [pipeline, state, load, selected, sizeVersion, t]);
  useEffect(() => onNodes?.(graph.nodes), [graph.nodes, onNodes]);

  return (
    <div className={cn('h-[420px] overflow-hidden rounded-lg border bg-card', className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodeOrigin={NODE_ORIGIN}
          fitView
          colorMode={resolved}
          fitViewOptions={FIT_OPTIONS}
          minZoom={0.3}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodesChange={onNodesChange}
          onNodeClick={(_, clicked) => onSelect?.(clicked.id)}
          onPaneClick={() => onSelect?.(null)}
        >
          <FitOnSwitch pipeline={pipeline.id} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
