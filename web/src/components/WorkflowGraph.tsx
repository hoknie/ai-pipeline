import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkflowTopology } from '../types.ts';

import { cn } from '../lib/cn.ts';
import { useTheme } from '../theme.ts';
import { Card } from '../ui/card.tsx';

import { StatusBadge } from './StatusBadge.tsx';
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

/** Fits the view when another workflow is opened, not on live updates. */
function FitOnSwitch({ workflow }: { workflow: string }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!initialized || fitted.current === workflow) return;
    if (fitted.current !== null) void fitView(FIT_OPTIONS);
    fitted.current = workflow;
  }, [initialized, workflow, fitView]);
  return null;
}

function Stage({ data, selected }: NodeProps<StageNode>) {
  const { t } = useTranslation();
  return (
    <Card
      className={cn(
        'grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1 px-3 py-2.5 text-xs',
        data.kind !== 'step' && 'bg-muted',
        data.active && 'border-status-run ring-4 ring-status-run-bg',
        selected && 'border-primary',
      )}
      data-testid={`stage-${data.step ?? data.kind}`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Top} id="back-in" />
      <Handle type="source" position={Position.Top} id="back-out" />
      <Handle type="source" position={Position.Bottom} id="down" />
      <Handle type="target" position={Position.Top} id="up" />
      <div className="truncate text-sm font-bold" title={data.title}>
        {data.title}
      </div>
      <div className="truncate text-muted-foreground" title={data.subtitle}>
        {data.subtitle}
      </div>
      {data.detail ? <div className="truncate text-muted-foreground">{data.detail}</div> : null}
      {data.groups.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {data.groups.map((group) => (
            <StatusBadge
              key={`${group.runId}/${group.slug}`}
              status={group.status}
              label={group.title}
              title={group.title}
            />
          ))}
        </div>
      ) : null}
      {data.attempts !== null ? (
        <div className="truncate text-muted-foreground">
          {t('topology.attempts', { n: data.attempts })}
          {data.costUsd ? ` · $${data.costUsd.toFixed(2)}` : ''}
        </div>
      ) : null}
    </Card>
  );
}

const NODE_TYPES = { stage: Stage };

/**
 * The graph of a workflow. With `live` the nodes carry the groups of active runs; without it
 * the graph is the plain scheme, as the editor previews it.
 */
export function WorkflowGraph({
  workflow,
  live,
  selected = null,
  onSelect,
  onNodes,
  className,
}: {
  workflow: WorkflowTopology;
  live?: Live | null;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Called with the laid out nodes whenever they change. */
  onNodes?: (nodes: StageNode[]) => void;
  /** Extra classes of the container, e.g. another height than the default 420px. */
  className?: string;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const state = useMemo(() => live ?? liveState(workflow, [], null), [live, workflow]);
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
    const raw = layout(workflow, state, t, sizes.current);
    const nodes = stabilize(previousNodes.current, raw.nodes, sizes.current, selected);
    const edges = stabilizeEdges(previousEdges.current, raw.edges);
    previousNodes.current = nodes;
    previousEdges.current = edges;
    return { nodes, edges };
  }, [workflow, state, selected, sizeVersion, t]);
  useEffect(() => onNodes?.(graph.nodes), [graph.nodes, onNodes]);

  return (
    <div className={cn('h-[420px] overflow-hidden rounded-lg border bg-card', className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
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
          <FitOnSwitch workflow={workflow.id} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
