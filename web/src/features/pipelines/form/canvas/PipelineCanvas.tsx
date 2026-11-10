import '@xyflow/react/dist/style.css';

import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../../shared/api/types.ts';
import { useTheme } from '../../../../shared/lib/browser/theme.ts';
import type { Draft } from '../steps/draft.ts';
import { canReturn, connectReturn, stepKeyOfNode } from '../steps/draftOps.ts';
import type { usePipelineEditor } from '../usePipelineEditor.ts';
import { AddEdge, AddStepContext } from './AddEdge.tsx';
import { followOf, liveSelection, selectionOfNode, type Selection } from './canvasModel.ts';
import { CanvasInspector } from './CanvasInspector.tsx';
import { CanvasNode } from './CanvasNode.tsx';
import { useCanvasGraph } from './useCanvasGraph.ts';
import { useCanvasHandlers } from './useCanvasHandlers.ts';

const NODE_TYPES = { canvas: CanvasNode };
const EDGE_TYPES = { add: AddEdge };
const FIT_OPTIONS = { padding: 0.15, maxZoom: 1 };

type Editor = ReturnType<typeof usePipelineEditor>;

type Flow = ReturnType<typeof useCanvasGraph>;

/** The props of the flow that do not depend on the person's actions. */
function flowProps(draft: Draft, setDraft: Editor['setDraft'], flow: Flow, editable: boolean) {
  return {
    nodes: flow.nodes,
    edges: flow.edges,
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    fitView: true,
    fitViewOptions: FIT_OPTIONS,
    minZoom: 0.3,
    deleteKeyCode: null,
    proOptions: { hideAttribution: true },
    onNodesChange: flow.onNodesChange,
    isValidConnection: (connection: { source: string | null; target: string | null }) => {
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
}: {
  editor: Editor;
  view: ConfigEditorResponse;
  sharedOnly: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const { draft, setDraft } = editor;
  const [chosen, setChosen] = useState<Selection | null>(null);
  const selection = liveSelection(chosen, draft);
  const editable = !disabled && followOf(view, draft) === null;
  const flow = useCanvasGraph(editor, view, editable, selection);
  const { onAdd, onDragStop, onKeyDown } = useCanvasHandlers(
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
              {...flowProps(draft, setDraft, flow, editable)}
              onNodeDragStop={onDragStop}
              onNodeClick={(_, clicked) => setChosen(selectionOfNode(clicked.id))}
              onEdgeClick={(_, clicked) => {
                const key = clicked.id.startsWith('return:') ? Number(clicked.id.slice(7)) : NaN;
                if (Number.isInteger(key)) setChosen({ kind: 'return', key });
              }}
              onPaneClick={() => setChosen(null)}
              colorMode={resolved}
              nodesDraggable={editable}
              nodesConnectable={editable}
            >
              <Background />
              <Controls showInteractive={false} />
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
      />
    </div>
  );
}
