import '@xyflow/react/dist/style.css';

import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../../shared/api/types.ts';
import { useTheme } from '../../../../shared/lib/browser/theme.ts';
import { OrthogonalEdge } from '../../../../shared/lib/graph/OrthogonalEdge.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import type { Draft } from '../steps/draft.ts';
import { canReturn, connectReturn, stepKeyOfNode } from '../steps/draftOps.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { AddEdge, AddStepContext } from './AddEdge.tsx';
import { GRID } from './canvasLayout.ts';
import {
  followOf,
  liveSelection,
  selectionOfEdge,
  selectionOfNode,
  type Selection,
} from './canvasModel.ts';
import { CanvasInspector } from './CanvasInspector.tsx';
import { CanvasNode } from './CanvasNode.tsx';
import { useCanvasGraph } from './useCanvasGraph.ts';
import { useCanvasHandlers } from './useCanvasHandlers.ts';

const NODE_TYPES = { canvas: CanvasNode };
const EDGE_TYPES = { add: AddEdge, orthogonal: OrthogonalEdge };
const FIT_OPTIONS = { padding: 0.15, maxZoom: 1 };

type Editor = ReturnType<typeof usePipelineEditor>;

type Flow = ReturnType<typeof useCanvasGraph>;

/** Puts the nodes back in the automatic layout and fits the diagram to the window. */
function ArrangeButton({ onArrange }: { onArrange: () => void }) {
  const { t } = useTranslation();
  const { fitView } = useReactFlow();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        onArrange();
        // the nodes take their places on the next render
        setTimeout(() => void fitView(FIT_OPTIONS), 0);
      }}
    >
      <LayoutGrid aria-hidden />
      {t('pipelines.canvasArrange')}
    </Button>
  );
}

/** The grid of the background, the zoom controls and the button that arranges the nodes. */
function FlowParts({ onArrange }: { onArrange: () => void }) {
  return (
    <>
      <Background gap={GRID} />
      <Controls showInteractive={false} />
      <Panel position="top-right">
        <ArrangeButton onArrange={onArrange} />
      </Panel>
    </>
  );
}

/** The props of the flow that do not depend on the person's actions. */
function flowProps(
  draft: Draft,
  setDraft: Editor['setDraft'],
  flow: Flow,
  editable: boolean,
  draggable: boolean,
) {
  return {
    nodesDraggable: draggable,
    nodesConnectable: editable,
    nodes: flow.nodes,
    edges: flow.edges,
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    connectionLineType: ConnectionLineType.SmoothStep,
    fitView: true,
    fitViewOptions: FIT_OPTIONS,
    minZoom: 0.3,
    deleteKeyCode: null,
    proOptions: { hideAttribution: true },
    onNodesChange: flow.onNodesChange,
    connectionMode: ConnectionMode.Loose,
    edgesReconnectable: true,
    // a connection is valid between the ends of an existing one (its sides move) or as a new return
    isValidConnection: (connection: { source: string | null; target: string | null }) => {
      if (flow.edges.some((e) => e.source === connection.source && e.target === connection.target))
        return true;
      const from = stepKeyOfNode(connection.source);
      const to = stepKeyOfNode(connection.target);
      return editable && from !== null && to !== null && canReturn(draft, from, to);
    },
    onConnect: (connection: { source: string; target: string }) => {
      if (editable) setDraft((current) => connectReturn(current, connection));
    },
  };
}

/** The draft as a diagram: steps, the split and the points; the same draft the form edits. */
export function PipelineCanvas({
  editor,
  view,
  sharedOnly,
  disabled,
  skipped,
}: {
  editor: Editor;
  view: ConfigEditorResponse;
  sharedOnly: boolean;
  disabled: boolean;
  /** A variant is shown: its skipped steps are marked and nothing can be dragged or changed. */
  skipped?: ReadonlySet<number>;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const { draft, setDraft } = editor;
  const [chosen, setChosen] = useState<Selection | null>(null);
  const stages = editor.preview.topology?.stages ?? null;
  const editable = !disabled && followOf(view, draft) === null;
  const flow = useCanvasGraph(
    editor,
    view,
    sharedOnly ? 'global' : view.repository,
    editable,
    liveSelection(chosen, draft, stages),
    skipped,
  );
  const selection = liveSelection(chosen, draft, stages, new Set(flow.edges.map((e) => e.id)));
  const { onAdd, onDragStop, onKeyDown, onReconnect } = useCanvasHandlers(
    editor,
    flow,
    selection,
    editable,
    setChosen,
  );
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        className="h-[calc(100dvh-18rem)] min-h-[420px] overflow-hidden rounded-lg border bg-card"
        role="application"
        aria-label={t('pipelines.canvas')}
        data-testid="pipeline-canvas"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <AddStepContext.Provider value={onAdd}>
          <ReactFlowProvider>
            <ReactFlow
              {...flowProps(draft, setDraft, flow, editable, skipped === undefined)}
              onNodeDragStop={onDragStop}
              onNodeClick={(_, clicked) => setChosen(selectionOfNode(clicked.id))}
              onReconnect={onReconnect}
              onEdgeClick={(_, clicked) => setChosen(selectionOfEdge(clicked.id))}
              onPaneClick={() => setChosen(null)}
              colorMode={resolved}
            >
              <FlowParts onArrange={flow.arrange} />
            </ReactFlow>
          </ReactFlowProvider>
        </AddStepContext.Provider>
      </div>
      <CanvasInspector
        selection={selection}
        draft={draft}
        onDraft={setDraft}
        view={view}
        pipelineId={editor.id}
        ids={flow.ids}
        errors={editor.errors}
        sharedOnly={sharedOnly}
        disabled={disabled}
        previewStages={flow.previewStages}
        nodes={flow.nodes}
        edges={flow.edges}
        onResetAnchors={(edge) => flow.resetAnchor(flow.anchorKeyOf(edge))}
      />
    </div>
  );
}
