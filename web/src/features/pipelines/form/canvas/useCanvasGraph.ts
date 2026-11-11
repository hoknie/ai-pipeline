import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslation } from 'react-i18next';

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
import { followOf, pointLists, selectedNodeId, type Selection } from './canvasModel.ts';

/** The nodes and edges of the draft, with the selection marked and the sizes the flow measured. */
export function useCanvasGraph(
  editor: ReturnType<typeof usePipelineEditor>,
  view: ConfigEditorResponse,
  editable: boolean,
  selection: Selection | null,
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
  const markedId = selectedNodeId(selection);
  const [nodes, setNodes] = useState<CanvasNodeType[]>(graph.nodes);
  useEffect(() => {
    setNodes((current) =>
      graph.nodes.map((item) => {
        const known = current.find((candidate) => candidate.id === item.id);
        return {
          ...item,
          selected: item.id === markedId,
          ...(known?.measured ? { measured: known.measured } : {}),
        };
      }),
    );
  }, [graph.nodes, markedId]);
  const { t } = useTranslation();
  const edges: CanvasEdge[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        ...(edge.id === CONFLICT_EDGE ? { label: t('topology.conflict') } : {}),
        selected: selection?.kind === 'return' && edge.id === `return:${selection.key}`,
      })),
    [graph.edges, selection, t],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  /** Puts every node back where the order of the draft says. */
  const resetNodes = () =>
    setNodes(graph.nodes.map((item) => ({ ...item, selected: item.id === markedId })));
  return { ids, previewStages, nodes, edges, onNodesChange, resetNodes };
}
