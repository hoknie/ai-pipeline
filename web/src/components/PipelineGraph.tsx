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

import type { StagedTopology } from '../pipelineStages.ts';

import { cost, usageText } from '../format.ts';
import { cn } from '../lib/cn.ts';
import type { MachineLoad } from '../specialistLoad.ts';
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

function Stage({ data, selected }: NodeProps<StageNode>) {
  const { t } = useTranslation();
  const usageLine =
    [
      usageText({ inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0 }),
      cost({ costUsd: data.costUsd }),
    ]
      .filter(Boolean)
      .join(' · ') || '—';
  const testId = data.step ?? (data.kind === 'action' ? data.stageId : data.kind);
  return (
    <Card
      className={cn(
        'relative grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1 px-3 py-2.5 text-xs',
        data.kind !== 'step' && 'bg-muted',
        data.condition !== null && 'border-dashed',
        data.active && 'border-status-run ring-4 ring-status-run-bg',
        data.busy?.full && 'border-status-warn bg-status-warn-bg',
        selected && 'border-primary',
      )}
      data-testid={`stage-${testId}`}
      data-conditional={data.condition !== null ? 'true' : undefined}
    >
      {data.sectionStart ? (
        <div
          className="pointer-events-none absolute -top-5 left-0 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
          data-testid={`section-${data.section}`}
        >
          {t(`topology.stages.section.${data.section}`)}
        </div>
      ) : null}
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
      {data.performer && data.performer !== data.subtitle ? (
        <div
          className="truncate text-muted-foreground"
          data-testid={`performer-${testId}`}
          title={data.performer}
        >
          {data.performer}
        </div>
      ) : null}
      {data.condition !== null ? (
        <div className="truncate font-medium" data-testid={`condition-${testId}`}>
          {data.condition}
        </div>
      ) : null}
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
      {data.busy && (data.busy.running > 0 || data.busy.max !== null) ? (
        <div
          className={cn('truncate text-muted-foreground', data.busy.full && 'font-medium')}
          data-testid={`busy-${testId}`}
        >
          {data.busy.max === null
            ? t('topology.busyUnlimited', { n: data.busy.running })
            : t('topology.busy', { n: data.busy.running, max: data.busy.max })}
          {data.busy.elsewhere > 0
            ? ` · ${t('topology.busyElsewhere', { n: data.busy.elsewhere })}`
            : ''}
        </div>
      ) : null}
      {data.attempts !== null ? (
        <>
          <div className="truncate text-muted-foreground">
            {t('topology.attempts', { n: data.attempts })}
          </div>
          <div
            className="truncate text-muted-foreground tabular-nums"
            data-testid={`usage-${data.step}`}
            title={usageLine}
          >
            {usageLine}
          </div>
        </>
      ) : null}
    </Card>
  );
}

const NODE_TYPES = { stage: Stage };

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
  pipeline: StagedTopology;
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
